# Ario browser extension privacy notice

Ario manages downloads through an Ario daemon running on your computer. The extension has no analytics, advertising, accounts, or developer-operated data collection service.

## What Ario uses

- **Connection and management.** The extension reads downloads, queues, health, and daemon settings over loopback HTTP. It uses them to show progress and perform the actions you choose. When you add a download, the extension sends the URLs, magnet links, or torrent file you selected, along with the chosen download settings, to the local daemon.
- **Link confirmation.** When you choose **Download with Ario** from a link menu, the extension uses that link to open a confirmation. Enabling **Use browser session** in that window lets Ario request applicable cookies for an eligible same-origin link. The extension sends the link and matching cookies to the local daemon if you submit it.
- **Browser capture.** Capture is enabled by default. While enabled, Ario briefly observes recent HTTP(S) request URLs, methods, redirects, and headers in memory and compares them with browser download details. Ario sends eligible download URLs and file details to the local daemon when you confirm a capture or choose automatic capture. If you also enable **Use browser session**, the extension can send the cookies and referrer observed on the final download request. Ario uses that context to fetch the file from its source.
- **Clipboard.** Ario writes a URL or destination folder path to the system clipboard when you click its copy button. To import links you paste the text yourself.
- **Private windows.** Ario is disabled in private or incognito windows.

## Where it stays

Browser-local extension storage holds the daemon address, theme, filters, draft queue and override choices, capture preferences, and handoff recovery records. Confirmation drafts and their URLs are held in browser session storage while the browser is running. The extension discards unsubmitted drafts on confirmation close and clears finished recovery records after reconciliation. Observed request headers stay in background memory until they expire or capture is disabled. The extension passes applicable session data directly to the daemon when an approved handoff needs it.

The local daemon stores download metadata and any session context required for retries. A session-bearing download can send its cookies and referrer back to the validated final download URL. Ordinary downloads contact the selected file source. Removing the download record deletes the daemon's saved session context. The browser's own download history follows the browser's retention settings.

## Controls

Turn off **Capture browser downloads** to stop observation and restore any unsubmitted paused download the browser can resume. Turn off **Use browser session** to stop sharing session context on future captures. You can revoke optional permissions in the browser's extension settings. Removing the extension clears its browser-local extension data. Manage completed or queued downloads and their files separately in Ario.

Ario uses browser data only to provide the download management and handoff features described here. Ario's use of this information adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements. [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies#protecting-user-privacy)
