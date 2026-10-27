export function createHash(_algorithm: string) {
  let content = '';
  return {
    update(data: string) {
      content += data;
      return this;
    },
    digest(_encoding: string): string {
      // Deterministic 64-char hex hash suitable for synchronous browser idempotency payload comparison
      let h1 = 0xdeadbeef ^ content.length;
      let h2 = 0x41c6ce57 ^ content.length;
      for (let i = 0; i < content.length; i++) {
        const ch = content.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
      const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
      return (hex1 + hex2).repeat(4);
    }
  };
}
