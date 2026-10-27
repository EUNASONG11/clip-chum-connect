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
