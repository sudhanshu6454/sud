# db/fixtures — TEST data only

`library.example.csv` is the paparazzi-library import's example file
(`packages/api/src/looks/library-import.ts`; the CLI's `looks import`). Every
person in it is fictional ("Demo Star One", "Demo Star Two"), every URL is on a
reserved example.com name, every reference is a `demo-` / `TEST-` placeholder,
and the in-house pages are those of `db/network.example.yaml`. The import
refuses these rows under `NODE_ENV=production`. The owner's real library file
lives on the server only (`/etc/afflino/library/library.csv`, read by
`deploy/linode/looks.sh import`) and never enters this repository.
