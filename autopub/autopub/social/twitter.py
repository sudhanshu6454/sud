"""X / Twitter: image + link via tweepy (v1.1 media upload, v2 create tweet)."""
from __future__ import annotations

import tweepy

from .base import Publisher, PublishResult, SocialPost

TCO_LENGTH = 23


class TwitterPublisher(Publisher):
    platform = "twitter"
    env_prefix = "TWITTER"
    required_env = ("API_KEY", "API_SECRET", "ACCESS_TOKEN", "ACCESS_SECRET")
    text_limit = 280

    def _publish(self, post: SocialPost) -> PublishResult:
        c = self.creds
        auth = tweepy.OAuth1UserHandler(c["API_KEY"], c["API_SECRET"], c["ACCESS_TOKEN"], c["ACCESS_SECRET"])
        api_v1 = tweepy.API(auth)
        client = tweepy.Client(consumer_key=c["API_KEY"], consumer_secret=c["API_SECRET"],
                               access_token=c["ACCESS_TOKEN"], access_token_secret=c["ACCESS_SECRET"])
        media_ids = None
        image = post.image_path(self.prefers_square)
        if image:
            media = api_v1.media_upload(filename=str(image))
            media_ids = [media.media_id]
            try:
                api_v1.create_media_metadata(media.media_id, post.title[:1000])
            except Exception:  # noqa: BLE001 - alt text is best effort
                pass
        text = self._text_with_link(post, link_len=TCO_LENGTH)
        resp = client.create_tweet(text=text, media_ids=media_ids)
        tweet_id = str(resp.data["id"])
        return PublishResult(self.platform, True, remote_id=tweet_id, url=f"https://x.com/i/web/status/{tweet_id}")
