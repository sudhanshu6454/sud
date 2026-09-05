"""Telegram channel via Bot API: photo + caption + link."""
from __future__ import annotations

import requests

from .base import Publisher, PublishResult, SocialPost

API = "https://api.telegram.org"


class TelegramPublisher(Publisher):
    platform = "telegram"
    env_prefix = "TELEGRAM"
    required_env = ("BOT_TOKEN", "CHAT_ID")   # CHAT_ID like @mychannel or -100123456789
    text_limit = 1024                          # photo caption limit

    def _publish(self, post: SocialPost) -> PublishResult:
        token, chat = self.creds["BOT_TOKEN"], self.creds["CHAT_ID"]
        text = self._text_with_link(post)
        image = post.image_path(prefer_square=False)
        if image:
            with open(image, "rb") as fh:
                resp = requests.post(f"{API}/bot{token}/sendPhoto", data={"chat_id": chat, "caption": text},
                                     files={"photo": fh}, timeout=self.timeout)
        else:
            resp = requests.post(f"{API}/bot{token}/sendMessage", data={"chat_id": chat, "text": text}, timeout=self.timeout)
        data = resp.json()
        if not data.get("ok"):
            raise RuntimeError(data.get("description", data))
        msg = data["result"]
        mid = str(msg["message_id"])
        username = (msg.get("chat") or {}).get("username")
        url = f"https://t.me/{username}/{mid}" if username else None
        return PublishResult(self.platform, True, remote_id=mid, url=url)
