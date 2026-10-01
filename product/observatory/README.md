# @ppl/product-observatory

R3 local-owner read model and browser UI. No additional external npm dependency.

Start the integrated UI from the repository root with `npm start`, or the explicitly synthetic fixture mode with `npm run demo:observatory`. This workspace is not a second independent Agent implementation and does not replace any vertical's domain model.

`ObservatoryReadModel` only reads/redacts snapshots; domain mutation stays in existing product services. HTTP asset/API routing is integrated by platform-gateway. All stored model/business strings are untrusted display data.

Run `npm test` in this directory after root workspace installation. Details and qualification boundaries: `../../docs/product/08_R3_Observatory.md` and `../../docs/product/09_R3_验收与风险.md`.
