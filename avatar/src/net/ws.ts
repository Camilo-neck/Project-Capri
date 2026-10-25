import type { ClientMessage, ServerMessage } from "./protocol.ts";

export interface Link {
  send(msg: ClientMessage): boolean;
}

/** WebSocket to the backend; reconnects every second while down. */
export function connect(url: string, onMessage: (m: ServerMessage) => void, onLink: (up: boolean) => void): Link {
  let ws: WebSocket;
  const open = () => {
    ws = new WebSocket(url);
    ws.onopen = () => onLink(true);
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      onLink(false);
      setTimeout(open, 1000);
    };
  };
  open();
  return {
    send(msg) {
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
  };
}
