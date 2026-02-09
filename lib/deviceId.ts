// Shared utility for device ID management
export function getDeviceId(): string {
  if (typeof window === "undefined") {
    throw new Error("getDeviceId can only be called on the client");
  }
  
  const key = "bar_oracle_device_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}
