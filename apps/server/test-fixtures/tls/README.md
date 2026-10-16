Throwaway certificates for the TLS tests only (`connections/drivers/tls.test.ts`):
an authority, a server certificate for `localhost` / `127.0.0.1` it signed,
and a client certificate. The authority's key was thrown away. Never use them anywhere else.
