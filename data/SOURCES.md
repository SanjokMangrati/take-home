# Where the two schedules come from

Both files are monthly updates of one real construction schedule, Dukhan Housing Project Phase IX, exported from Primavera P6 17.12. They were published in the public GitHub repository [Projecting-Success-Solutions-Portal/hack26-autoplan-wbs-generator](https://github.com/Projecting-Success-Solutions-Portal/hack26-autoplan-wbs-generator), in `Data/Extra Schedule Data/`, as of commit [`49a889b`](https://github.com/Projecting-Success-Solutions-Portal/hack26-autoplan-wbs-generator/tree/49a889b2639c7db40c8828820d932e7877f3e0eb/Data/Extra%20Schedule%20Data) (14 April 2026).

The files here are byte-for-byte copies. Only the names changed.

| File here                  | Original name                                     | Data date   | Bytes      | SHA-256                                                            |
| -------------------------- | ------------------------------------------------- | ----------- | ---------- | ------------------------------------------------------------------ |
| `dukhan-ph9-update-06.xer` | `DUKHAN HOUSING PROJECT PHASE IX 6th update.xer`  | 27 Apr 2013 | 13,794,246 | `5944302705a74054d59b020bd70905ec86bd4672b20e8c01ebb11ef1aa4a4b12` |
| `dukhan-ph9-update-12.xer` | `DUKHAN HOUSING PROJECT PHASE IX 12th update.xer` | 2 Nov 2013  | 13,743,618 | `b6087f8602a80fef5c3e0bee9423ff0318e5801e2a153de41359201eed9bf17d` |

To confirm a copy is unchanged:

```sh
sha256sum data/*.xer
```

The source repository had no license file. If you are the owner please ask and the files will be removed. I only intend to use for demo purposes and will be deleted right after.
