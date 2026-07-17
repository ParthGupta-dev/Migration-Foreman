"""Native FastAPI WebSocket rooms, one per campaignId.

Server -> client events only, per the section 7 WebSocket contract. Every
broadcast is {"event": <name>, "data": <payload>}.
"""

import logging

from fastapi import WebSocket

logger = logging.getLogger("migration_foreman.ws")


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[str, list[WebSocket]] = {}

    async def connect(self, campaign_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._rooms.setdefault(campaign_id, []).append(websocket)

    def disconnect(self, campaign_id: str, websocket: WebSocket) -> None:
        sockets = self._rooms.get(campaign_id, [])
        if websocket in sockets:
            sockets.remove(websocket)
        if not sockets and campaign_id in self._rooms:
            del self._rooms[campaign_id]

    async def broadcast(self, campaign_id: str, event: str, data: dict) -> None:
        for websocket in list(self._rooms.get(campaign_id, [])):
            try:
                await websocket.send_json({"event": event, "data": data})
            except Exception:
                logger.warning("WS send failed for campaign %s; dropping socket", campaign_id)
                self.disconnect(campaign_id, websocket)


manager = ConnectionManager()
