"""Minimal S3 client for listing buckets, objects, creating buckets, and uploading.

Can work with either admin credentials (from env vars) or per-user credentials
(passed at construction time).
"""

from __future__ import annotations

import boto3
from botocore.client import Config

from app.config import settings


class RGWError(Exception):
    pass


class RGWClient:
    """S3 client that talks to Ceph RGW.

    If *access_key* and *secret_key* are provided, they are used directly.
    Otherwise falls back to the defaults from ``app.config.Settings``.
    """

    def __init__(
        self,
        access_key: str | None = None,
        secret_key: str | None = None,
    ) -> None:
        self.endpoint = settings.rgw_endpoint
        self.access_key = access_key or settings.rgw_access_key
        self.secret_key = secret_key or settings.rgw_secret_key
        self._client = None

    def _get_client(self):
        if self._client is None:
            session = boto3.session.Session(
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
            )
            self._client = session.client(
                "s3",
                endpoint_url=self.endpoint,
                config=Config(signature_version="s3v4", connect_timeout=5, read_timeout=30),
            )
        return self._client

    # ── Bucket listing ──

    def list_buckets(self) -> list[dict]:
        """Return [{name, creation_date}], newest first."""
        resp = self._get_client().list_buckets()
        buckets = [
            {"name": b["Name"], "creation_date": str(b.get("CreationDate", ""))}
            for b in resp.get("Buckets", [])
        ]
        buckets.sort(key=lambda x: x["creation_date"], reverse=True)
        return buckets

    def create_bucket(
        self,
        name: str,
        *,
        acl: str | None = None,
        object_lock_enabled: bool = False,
    ) -> dict:
        """Create a new S3 bucket.

        Object Lock **must** be opted into at create time — Ceph rejects
        PutObjectLockConfiguration with HTTP 409 ``InvalidBucketState``
        otherwise. The canned ACL is forwarded the same way; we prefer
        setting it here over a follow-up ``put_bucket_acl`` to keep the
        bucket in its target state immediately.

        Tentacle (dev-branch RGW) workaround: this build emits a verbose
        JSON body on CreateBucket that boto3 cannot parse, so boto3
        raises ``Internal Server Error`` (Code=500) even though the
        bucket was actually created. We swallow that specific failure
        if ``head_bucket`` confirms the bucket exists — otherwise the
        wizard would 502 and every follow-up setting (lock retention,
        tags, policy, etc.) would be skipped. Real failures (NoSuchKey,
        BucketAlreadyOwnedByYou, AccessDenied, …) still propagate.
        """
        kwargs: dict = {"Bucket": name}
        if acl:
            kwargs["ACL"] = acl
        if object_lock_enabled:
            kwargs["ObjectLockEnabledForBucket"] = True
        client = self._get_client()
        try:
            client.create_bucket(**kwargs)
            return {"name": name, "created": True}
        except Exception as exc:
            # Spurious 500 from the tentacle RGW: bucket actually exists.
            if "Internal Server Error" in str(exc) or "(500)" in str(exc):
                try:
                    client.head_bucket(Bucket=name)
                except Exception:
                    raise RGWError(str(exc)) from exc
                return {"name": name, "created": True, "rgw_quirk_500": True}
            raise RGWError(str(exc)) from exc

    def put_bucket_versioning(self, bucket: str, status: str) -> dict:
        """Set versioning to ``Enabled`` or ``Suspended``.

        There is no "Disabled" — that's the implicit state of a bucket
        that has never had versioning set.
        """
        if status not in ("Enabled", "Suspended"):
            raise RGWError(f"versioning status must be Enabled or Suspended, got {status!r}")
        try:
            self._get_client().put_bucket_versioning(
                Bucket=bucket,
                VersioningConfiguration={"Status": status},
            )
            return {"bucket": bucket, "versioning": status}
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def put_object_lock_configuration(
        self,
        bucket: str,
        mode: str,
        *,
        days: int | None = None,
        years: int | None = None,
    ) -> dict:
        """Apply the default retention rule for a lock-enabled bucket.

        ``days`` and ``years`` are mutually exclusive — RGW returns
        ``MalformedXML`` otherwise. The bucket must already have been
        created with ``ObjectLockEnabledForBucket=True``.
        """
        if (days is None) == (years is None):
            raise RGWError("Provide exactly one of days or years")
        if mode not in ("GOVERNANCE", "COMPLIANCE"):
            raise RGWError(f"object-lock mode must be GOVERNANCE or COMPLIANCE, got {mode!r}")
        retention: dict = {"Mode": mode}
        if days is not None:
            retention["Days"] = days
        else:
            retention["Years"] = years
        try:
            self._get_client().put_object_lock_configuration(
                Bucket=bucket,
                ObjectLockConfiguration={
                    "ObjectLockEnabled": "Enabled",
                    "Rule": {"DefaultRetention": retention},
                },
            )
            return {"bucket": bucket, "object_lock": {"mode": mode, **retention}}
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def put_bucket_tagging(self, bucket: str, tags: list[dict]) -> dict:
        """Set the TagSet on a bucket. ``tags`` is ``[{Key, Value}, ...]``.

        Note: boto3's ``create_bucket`` accepts a ``Tags`` field on
        ``CreateBucketConfiguration``, but it is AWS-only — RGW ignores
        it. Always issue this separately.
        """
        try:
            self._get_client().put_bucket_tagging(
                Bucket=bucket,
                Tagging={"TagSet": tags},
            )
            return {"bucket": bucket, "tagging_set": True}
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def get_bucket_versioning(self, bucket: str) -> dict:
        """Return ``{status, mfa_delete}``. A bucket that's never had
        versioning set has no Status field — we surface that as
        ``status=None`` so the UI can show "Unversioned" cleanly.
        """
        try:
            resp = self._get_client().get_bucket_versioning(Bucket=bucket)
            return {
                "status": resp.get("Status"),
                "mfa_delete": resp.get("MFADelete"),
            }
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def get_object_lock_configuration(self, bucket: str) -> dict | None:
        """Return the lock config, or None if the bucket was created
        without Object Lock. Distinguish between "lock not enabled" and
        "lock enabled, no default retention" — both are valid states
        and only the second can have its retention modified.
        """
        try:
            resp = self._get_client().get_object_lock_configuration(Bucket=bucket)
            return resp.get("ObjectLockConfiguration")
        except Exception as exc:
            # ObjectLockConfigurationNotFoundError → bucket exists but lock not enabled.
            msg = str(exc)
            if "ObjectLockConfigurationNotFoundError" in msg or "NotFoundError" in msg:
                return None
            raise RGWError(msg) from exc

    def get_bucket_tagging(self, bucket: str) -> list[dict]:
        """Return the TagSet as ``[{Key, Value}, ...]``, or [] if unset."""
        try:
            resp = self._get_client().get_bucket_tagging(Bucket=bucket)
            return resp.get("TagSet", [])
        except Exception as exc:
            if "NoSuchTagSet" in str(exc):
                return []
            raise RGWError(str(exc)) from exc

    def delete_bucket_tagging(self, bucket: str) -> dict:
        try:
            self._get_client().delete_bucket_tagging(Bucket=bucket)
            return {"bucket": bucket, "tagging_cleared": True}
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def get_bucket_acl(self, bucket: str) -> dict:
        """Return ``{owner, grants}`` — caller-friendly subset of the boto3
        response. Grants come back verbatim so the UI can show whichever
        grantees the bucket has (group URIs, canonical IDs, …).
        """
        try:
            resp = self._get_client().get_bucket_acl(Bucket=bucket)
            return {
                "owner": resp.get("Owner", {}),
                "grants": resp.get("Grants", []),
            }
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def get_bucket_cors(self, bucket: str) -> list[dict]:
        """Return the CORS rules list, or [] if none. CORS-not-found is
        the common case (we only install one rule on create), not an
        error worth surfacing.
        """
        try:
            resp = self._get_client().get_bucket_cors(Bucket=bucket)
            return resp.get("CORSRules", [])
        except Exception as exc:
            if "NoSuchCORSConfiguration" in str(exc):
                return []
            raise RGWError(str(exc)) from exc

    def put_bucket_acl(self, bucket: str, canned_acl: str) -> dict:
        """Apply a canned ACL post-create.

        RGW supports exactly four canned values; anything else returns
        InvalidArgument. Prefer ``create_bucket(acl=...)`` when possible
        so the bucket is born in its target state.
        """
        ALLOWED = {"private", "public-read", "public-read-write", "authenticated-read"}
        if canned_acl not in ALLOWED:
            raise RGWError(f"unsupported canned ACL {canned_acl!r}")
        try:
            self._get_client().put_bucket_acl(Bucket=bucket, ACL=canned_acl)
            return {"bucket": bucket, "acl": canned_acl}
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    # ── Object operations ──

    def list_objects(
        self, bucket: str, max_keys: int = 100, continuation_token: str | None = None
    ) -> dict:
        """Return {objects: [{key, size, last_modified}], is_truncated, key_count, next_token}."""
        try:
            kwargs: dict = {"Bucket": bucket, "MaxKeys": max_keys}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            resp = self._get_client().list_objects_v2(**kwargs)
        except Exception as exc:
            raise RGWError(str(exc)) from exc

        contents = resp.get("Contents", [])
        objects = [
            {
                "key": obj["Key"],
                "size": obj["Size"],
                "last_modified": str(obj.get("LastModified", "")),
            }
            for obj in contents
        ]
        return {
            "objects": objects,
            "is_truncated": resp.get("IsTruncated", False),
            "key_count": resp.get("KeyCount", len(objects)),
            "next_token": resp.get("NextContinuationToken"),
            "bucket": bucket,
        }

    def list_all_objects(self, bucket: str) -> dict:
        """Paginate through all objects in a bucket. Returns {objects, total_count}."""
        all_objects = []
        token = None
        while True:
            result = self.list_objects(bucket, max_keys=1000, continuation_token=token)
            all_objects.extend(result["objects"])
            if not result["is_truncated"]:
                break
            token = result["next_token"]
        return {
            "objects": all_objects,
            "total_count": len(all_objects),
            "bucket": bucket,
        }

    def upload_object(self, bucket: str, key: str, data: bytes) -> dict:
        """Upload raw bytes as an object."""
        try:
            self._get_client().put_object(Bucket=bucket, Key=key, Body=data)
            return {"bucket": bucket, "key": key, "uploaded": True}
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def get_s3_client(self):
        """Expose the underlying boto3 S3 client for admin operations."""
        return self._get_client()

    def delete_object(self, bucket: str, key: str) -> dict:
        """Delete an object."""
        try:
            self._get_client().delete_object(Bucket=bucket, Key=key)
            return {"bucket": bucket, "key": key, "deleted": True}
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def delete_bucket(self, bucket: str) -> dict:
        """Delete an empty bucket."""
        try:
            self._get_client().delete_bucket(Bucket=bucket)
            return {"bucket": bucket, "deleted": True}
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def get_bucket_policy(self, bucket: str) -> str | None:
        """Get the bucket policy as a JSON string."""
        try:
            resp = self._get_client().get_bucket_policy(Bucket=bucket)
            return resp.get("Policy")
        except Exception as exc:
            # Usually raises NoSuchBucketPolicy if none exists
            if "NoSuchBucketPolicy" in str(exc):
                return None
            raise RGWError(str(exc)) from exc

    def put_bucket_policy(self, bucket: str, policy: str) -> dict:
        """Set the bucket policy (JSON string)."""
        try:
            self._get_client().put_bucket_policy(Bucket=bucket, Policy=policy)
            return {"bucket": bucket, "policy_updated": True}
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def delete_bucket_policy(self, bucket: str) -> dict:
        """Remove the bucket policy."""
        try:
            self._get_client().delete_bucket_policy(Bucket=bucket)
            return {"bucket": bucket, "policy_deleted": True}
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def presigned_url(self, bucket: str, key: str, expires_in: int = 3600) -> str:
        """Generate a presigned download URL."""
        try:
            url = self._get_client().generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=expires_in,
            )
            return url
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    # ── Multipart upload ──
    #
    # The browser uses CreateMultipartUpload + UploadPart + CompleteMultipartUpload
    # to push large files directly to RGW. The backend mints the upload id and the
    # per-part presigned URLs, then finalizes. See app/api/multipart.py.

    def create_multipart_upload(
        self, bucket: str, key: str, content_type: str | None = None
    ) -> str:
        """Begin a multipart upload. Returns the upload id."""
        try:
            params: dict = {"Bucket": bucket, "Key": key}
            if content_type:
                params["ContentType"] = content_type
            resp = self._get_client().create_multipart_upload(**params)
            return resp["UploadId"]
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def presigned_upload_part_url(
        self,
        bucket: str,
        key: str,
        upload_id: str,
        part_number: int,
        expires_in: int = 3600,
    ) -> str:
        """Presigned PUT for a single part. Browser uses this directly against RGW."""
        try:
            return self._get_client().generate_presigned_url(
                "upload_part",
                Params={
                    "Bucket": bucket,
                    "Key": key,
                    "UploadId": upload_id,
                    "PartNumber": part_number,
                },
                ExpiresIn=expires_in,
            )
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def complete_multipart_upload(
        self,
        bucket: str,
        key: str,
        upload_id: str,
        parts: list[dict],
    ) -> dict:
        """Finalize a multipart upload. *parts* is [{PartNumber, ETag}, ...] sorted asc."""
        try:
            resp = self._get_client().complete_multipart_upload(
                Bucket=bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": parts},
            )
            return {
                "bucket": bucket,
                "key": key,
                "etag": resp.get("ETag"),
                "location": resp.get("Location"),
            }
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def abort_multipart_upload(self, bucket: str, key: str, upload_id: str) -> dict:
        """Cancel an in-progress multipart upload, releasing the parts on RGW."""
        try:
            self._get_client().abort_multipart_upload(
                Bucket=bucket, Key=key, UploadId=upload_id
            )
            return {"bucket": bucket, "key": key, "aborted": True}
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    def list_parts(self, bucket: str, key: str, upload_id: str) -> list[dict]:
        """List parts already uploaded for *upload_id*. Used by resume to skip work."""
        try:
            parts: list[dict] = []
            marker = 0
            while True:
                resp = self._get_client().list_parts(
                    Bucket=bucket,
                    Key=key,
                    UploadId=upload_id,
                    PartNumberMarker=marker,
                )
                for p in resp.get("Parts", []):
                    parts.append(
                        {
                            "part_number": p["PartNumber"],
                            "etag": p["ETag"],
                            "size": p["Size"],
                        }
                    )
                if not resp.get("IsTruncated"):
                    break
                marker = resp.get("NextPartNumberMarker", 0)
            return parts
        except Exception as exc:
            raise RGWError(str(exc)) from exc

    # ── CORS ──

    def put_bucket_cors(self, bucket: str, allowed_origin: str = "*") -> dict:
        """Install a CORS rule that lets the dashboard PUT parts directly from the browser.

        ExposeHeaders=ETag is the key bit — without it, the browser can't read the
        per-part ETag from the response and CompleteMultipartUpload fails.
        """
        try:
            self._get_client().put_bucket_cors(
                Bucket=bucket,
                CORSConfiguration={
                    "CORSRules": [
                        {
                            "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
                            "AllowedOrigins": [allowed_origin],
                            "AllowedHeaders": ["*"],
                            "ExposeHeaders": ["ETag"],
                            "MaxAgeSeconds": 3000,
                        }
                    ]
                },
            )
            return {"bucket": bucket, "cors_set": True}
        except Exception as exc:
            raise RGWError(str(exc)) from exc
