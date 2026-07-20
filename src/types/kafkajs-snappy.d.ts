declare module 'kafkajs-snappy' {
  interface SnappyCodec {
    compress(encoder: { buffer: Uint8Array }): Promise<Uint8Array>;
    decompress(buffer: Uint8Array): Promise<Uint8Array>;
  }

  const createSnappyCodec: () => SnappyCodec;
  export default createSnappyCodec;
}
