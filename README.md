# Vision MLOps Platform

An MLOps loop for a fleet of deep-learning vision inspection PCs: **collect** the NG crops
the DL engine flagged on every PC, **cluster** them by DL class, let engineers **review**
each one as Real NG or Overkill, turn those verdicts into the next **training set**, and
**deploy** the retrained model back to every PC.

This repository is an interactive web demo of that platform. It runs entirely in the
browser against a simulated fleet.

```
  32 vision PCs (SMB)                         engineering workstation
┌────────────────────┐   01 Collect    ┌─────────────────────────────────────┐
│ DL engine          │ ──────────────► │ <out>\<VISION>\<class>\*.jpg        │
│  ├ result CSV      │                 │        │ 02 Cluster (by DL class)   │
│  └ NG crops        │                 │        ▼                            │
│                    │                 │ 03 Review  1 = Real NG  2 = Overkill│
│ <ENGINE>\Model_*   │                 │        │                            │
│  └ DL_VERSION\     │   05 Deploy     │        ▼                            │
│     (backups)      │ ◄────────────── │ 04 dataset folder → training set    │
└────────────────────┘  overwrite-only └─────────────────────────────────────┘
                         + backup
```

## Pages

| Page | What it does | Original desktop tool |
| --- | --- | --- |
| **Overview** | Today's session, the loop at a glance, fleet grid (lines × visions) with each PC's deployed model, activity | - |
| **01 Collect** | Session per DL model (single / range / specific dates, PC picker, output folder). Resolves each PC-day's product from its result CSV, crawls crop folders or locates images from CSV rows, copies SourceMap + ActiveMap/mask into `<out>\<VISION>\<class>\` with live progress and log | Result Fetcher - Fetch tab |
| **02 Review** | Class list → occurrence list → SourceMap / ActiveMap side by side with zoom & pan. `1` Real NG, `2` Overkill, `Ctrl+Z` undo. Each verdict copies the crop into `<dataset>\<MODEL>\<VISION>\<class>\<label>\`, shown live in a dataset-folder panel beside the viewer | Result Fetcher - Viewer tab |
| **03 Dataset** | The dataset folder read as a training set: verdict split and DL overkill rate per class, folder tree, CSV manifest export | - |
| **04 Deploy** | Pick PCs, load a model package (Browse… the release folder; incomplete exports without `model.bin` are refused) and a target folder from the **intersection** of the selected PCs' model folders. Dry run writes a marker listing what would change; inject does an overwrite-only copy with a `DL_VERSION` backup, 4 PCs at a time, with per-PC status | Model Injector |

## Stack

React 19, TypeScript, Vite, React Router, TensorFlow.js (MobileNet v2, loaded on demand). 

---

Built by Minjun Lee.
