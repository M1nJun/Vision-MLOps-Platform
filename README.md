# Vision MLOps Platform

A workflow platform for keeping the deep-learning inspection models on a factory's vision
PCs improving: gather the images the models flagged, review them quickly, turn the
verdicts into training data, and roll the retrained model back out to every PC.

## The problem

A production line runs dozens of vision PCs, each executing deep-learning inspection.
Every PC stores its results on its own local disk: the original image and its heat map,
filed into folders by model and by predicted class.

Improving a model meant working against that layout by hand:

- **Collecting** - an engineer walked to each PC and copied the images onto a USB stick,
  one machine at a time.
- **Reviewing** - the copied images were checked in a plain file explorer and image
  viewer, then sorted into real defects and overkills by dragging files around. Hundreds
  of images per class made this take days.
- **Deploying** - once a model was retrained, it had to be installed again by visiting
  each inspection PC in turn.

## The solution

```
  vision PCs (SMB, internal network)             engineering workstation
┌──────────────────────────┐   1 Collect   ┌──────────────────────────────────────┐
│ DL inspection engine     │ ────────────► │ <out>\<vision>\<class>\*.jpg         │
│  ├ result CSV            │               │        │ 2 Cluster (within each class)│
│  └ images by model/class │               │        ▼                              │
│                          │               │ 3 Review   1 = Real NG  2 = Overkill  │
│ model folders            │               │        │                              │
│  └ DL_VERSION\ (backups) │   5 Deploy    │        ▼                              │
│                          │ ◄──────────── │ 4 Dataset folder → retrain the model  │
└──────────────────────────┘               └──────────────────────────────────────┘
```

1. **Collect** - pulls the flagged images from every selected PC over SMB on the internal
   network into one workstation, organised by model, vision and class. The day's product
   is read from each PC's result CSV, so the right folders are found without input.
2. **Cluster** - inside each predicted class, look-alike images are grouped so that one
   kind of defect is reviewed together (see below).
3. **Review** - a keyboard-driven viewer: `1` marks a real defect, `2` an overkill,
   `Ctrl+Z` undoes. Each verdict copies the image into a dataset folder at once, and the
   next image opens.
4. **Dataset** - that folder is laid out as `<model>\<vision>\<class>\<RealNG|Overkill>`,
   ready to add to the training set. Per-class overkill rates show which model most needs
   retraining.
5. **Deploy** - the retrained model package is pushed to many PCs at once over SMB: an
   overwrite-only copy, with the package first kept under `DL_VERSION\` on each PC for
   rollback. A dry run writes a marker listing exactly what would change.

### Clustering within each class

The inspection model has already decided each image's class, but images within one class
still differ in appearance - and those sub-types are rarely equally likely to be real.

1. **Embed** each image with a pretrained CNN (MobileNet v2, ImageNet weights,
   penultimate layer, 1280-d).
2. **Reduce** with PCA to 12 dimensions.
3. **Cluster** with k-means++ for k = 2-4 per (vision, class) group, keeping the k with
   the best mean silhouette score.

## This repository

An interactive web demo of the platform. It runs entirely in the browser against a
simulated fleet - every PC, address, image and model is synthetic - and reproduces the
behaviour of the original Python desktop tools.

| Page | |
| --- | --- |
| Overview | Today's session, the five stages at a glance, fleet grid with each PC's deployed model |
| Collect | Date and PC selection, fetch with live progress and log, clustering afterwards |
| Review | Classes, crops grouped by cluster, image viewer with zoom/pan, live dataset folder |
| Dataset | Verdict split and overkill rate per class, dataset folder tree, CSV manifest export |
| Deploy | Load a model package, target folder from the intersection of selected PCs, dry run and inject with per-PC status |

### Structure

```
src/
  pages/        one component per stage (Overview, Collect, Review, Dataset, Deploy)
  components/   shared UI - image viewer, date and PC pickers, cluster status, log
  sim/
    fleet.ts    the simulated plant: PCs, models, model folders, release packages
    collect.ts  what a fetch finds, date handling, output and dataset paths
    images.ts   procedural inspection images (source, heat map, mask)
    cluster.ts  embedding, PCA, k-means and silhouette
    store.tsx   shared state across pages; runs clustering after each fetch
  theme.css     the dark HUD design system
```

React 19, TypeScript, Vite, React Router, TensorFlow.js (loaded only when clustering runs).

### Run

```bash
npm install
npm run dev
```

`npm run build` writes a static site to `dist/`. Pushing to `main` publishes it to
GitHub Pages through `.github/workflows/deploy.yml`.

---

Built by Minjun Lee.
