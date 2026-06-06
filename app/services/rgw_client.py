from __future__ import annotations

import os

import boto3
from botocore.client import Config


class RGWError(Exception):
    pass


class RGWClient:
    def __init__(self) -> None:
        self.endpoint = os.getenv("RGW_ENDPOINT", "http://142.132.138.10:80")
        self.access_key = os.getenv("RGW_ACCESS_KEY", "admin")
        self.secret_key = os.getenv("RGW_SECRET_KEY", "admin123")
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
                config=Config(signature_version="s3v4", connect_timeout=5, read_timeout=10),
            )
        return self._client

    def list_buckets(self) -> list[dict]:
        resp = self._get_client().list_buckets()
        buckets = [
            {"name": b["Name"], "creation_date": str(b.get("CreationDate", ""))}
            for b in resp.get("Buckets", [])
        ]
        buckets.sort(key=lambda x: x["creation_date"], reverse=True)
        return buckets

    def list_objects(self, bucket: str, max_keys: int = 100, continuation_token: str | None = None) -> dict:
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
