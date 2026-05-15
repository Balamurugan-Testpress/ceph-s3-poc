from textual.app import App, ComposeResult
from textual.widgets import Footer, Header, Static

from tui.api.client import get_health


class CephS3TUI(App):
    async def on_mount(self):
        health = await get_health()
        self.query_one("#status", Static).update(f"API Status: {health['status']}")

    def compose(self) -> ComposeResult:
        yield Header()
        yield Static("Loading...", id="status")
        yield Footer()


if __name__ == "__main__":
    CephS3TUI().run()
