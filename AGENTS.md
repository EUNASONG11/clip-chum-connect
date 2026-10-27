<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- External week-assignment saves only create/update the assignment and set needs_resync; completion resync runs via the "연동 점검" flow one [class, week] per request in 50-student batches — why: long resyncs after a response get cut off and exceed Worker subrequest limits.
- Individual video unlock management uses authenticated, branch-scoped database RPCs for bulk state calculation and atomic soft-delete writes; this avoids per-student Worker requests and enforces permissions outside the UI.
- Individual unlock surfaces share one semantic status badge component so state icons and presentation remain consistent across video and student rows.
- Messaging and class student statistics share service-role-only class_student_video_targets after server authorization; class_student_messaging_counts aggregates targets and completions in PostgreSQL, selects one non-deleted external student per user by descending id, and messaging paginates only student count rows with all selected video IDs in each POST RPC to reduce outbound requests without eligibility drift.
- Messaging student DTO mapping and phone normalization live in the browser-safe messaging-students module so count and contact output rules remain independently testable.
