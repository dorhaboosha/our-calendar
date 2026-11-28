// Whether the app can reach the server (spec 8.1), for the notice shown when it can't:
// the device is offline, or the last request that reported here failed. Not
// navigator.onLine alone, which only says a network is connected (Wi-Fi without
// internet counts as online).

let requestFailed = false;
const listeners = new Set<() => void>();

/** Called after a request: whether it reached the server. */
export function reportRequest(ok: boolean) {
  if (requestFailed === !ok) return;
  requestFailed = !ok;
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore. */
export function subscribeToConnection(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export const isDisconnected = () => requestFailed || !navigator.onLine;
/** The server render assumes a connection; the browser corrects it after hydration. */
export const isDisconnectedOnServer = () => false;
