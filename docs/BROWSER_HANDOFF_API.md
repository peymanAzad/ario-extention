# Browser handoff API

Phase 6 implements protocol version 1 on the loopback daemon. Browser requests use a Chrome or Firefox extension origin. Native local clients can omit `Origin`. All handoff POSTs use `Content-Type: application/json`. Handoff reads use GET without a body.

## Capability discovery

`GET /browser-capabilities` returns bare JSON. The daemon reports its local timezone when it can identify it by name. An unidentified timezone is `null`.

```json
{
  "protocol_version": 1,
  "staged_handoff": true,
  "http_session": true,
  "daemon_timezone": "Asia/Tbilisi"
}
```

A 404 means an older daemon. The extension keeps management routes available and only enables version-1 handoff integrations when the version matches and `staged_handoff` is true. Use `http_session` to check availability of session context separately. Transport errors and malformed success responses remain distinguishable from a missing endpoint.

## Stage a request

Send `POST /browser-handoffs` with a client-generated UUID and the final URL observed by the browser.

```json
{
  "id": "ae4b45f1-e928-4be6-b569-c61625158f16",
  "request": {
    "url": "https://example.test/download/report.pdf?signature=example",
    "method": "GET",
    "queue_id": 1,
    "start_immediately": true,
    "suggested_filename": "Quarterly report.pdf",
    "finetune_override": {
      "connections_per_download": 2,
      "max_retries": 0
    },
    "session": {
      "cookie": "example_session=fixture",
      "referrer": "https://example.test/reports",
      "user_agent": "Example browser"
    }
  }
}
```

- HTTP(S) requires an explicit `GET` and an absolute URL without user information or a fragment. The only optional session fields are `cookie`, `referrer`, and `user_agent`. Send only values applicable to the observed final request. Referrer must also be an absolute HTTP(S) URL without user information or a fragment.
- Public BitTorrent magnets with a v1 info hash are accepted. Omit `method`, `session`, and `suggested_filename` for magnets.
- Omit optional fields or send `null`. Suggested filenames must be a single safe filename. Use the existing `FineTune` field names. Omitted or null overrides inherit queue settings and explicit zeros are preserved.
- The daemon validates the selected queue, configured destination, and schedule eligibility for Start now before acknowledging a new stage. Staging makes no download record or aria2 request.
- Replaying the same UUID and normalized request returns the current receipt. Reusing the UUID for a different request gets HTTP 409. A confirmed stage lets the browser proceed with cancellation. If browser cancellation fails, abort the stage.

## Reconcile, commit, and abort

Every successful route returns the same receipt shape. A staged or aborted receipt has a null download ID. A committed receipt keeps the original ID even after that download is deleted.

```json
{
  "id": "ae4b45f1-e928-4be6-b569-c61625158f16",
  "state": "committed",
  "download_id": 42
}
```

| Endpoint                             | Request body | Behavior                                                                                                                                                                            |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /browser-handoffs/{id}`         | None         | Reports `staged`, `committed`, or `aborted` after a restart or uncertain response.                                                                                                  |
| `POST /browser-handoffs/{id}/commit` | `{}`         | Creates one download and records its ID atomically. Subsequent commits return the same receipt without starting the download again. Committing an aborted request returns HTTP 409. |
| `POST /browser-handoffs/{id}/abort`  | `{}`         | Discards the staged payload and returns an aborted receipt. Repeated aborts return the same receipt. Aborting a committed request returns HTTP 409.                                 |

A valid but unknown ID gets HTTP 404. A missing queue rejects a new stage. Deleting a queue aborts its staged requests and purges their payloads. A queue or schedule can change after staging. The client should reconcile any failed commit and use the original browser history for recovery when necessary.

A successful commit means the record is durable. The scheduler takes over from there. Start now requests the next eligible slot subject to queue capacity and the configured schedule. Save for later leaves the record eligible through ordinary queue starts and scheduling.

## Session handling

The daemon serves session-bearing transfers to aria2 over an authenticated loopback route. It sends the optional headers only to the stored final URL, streams the response, preserves byte ranges, and refuses every redirect. Retries use the same stored URL and session context. If a daemon restarts on a different address, retry interrupted session-bearing transfers from Ario to obtain a transfer URL for the new address.

Session headers are private daemon data. Receipts, download reads, and transfer diagnostics omit them. Download deletion, completed-record cleanup, and queue deletion remove associated session data. A staged payload is cleared on commit, abort, or queue deletion. The receipt and its request fingerprint stay available for reconciliation. The transfer URL supplied by the browser remains visible in ordinary download management, including any query string it carries.
