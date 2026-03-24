# database

Shared database schema project for the repository.

Contents:

- Common DDL exports used by `backend` and `train`
- Kline schema compatibility helper
- Generated SQL bootstrap file for Docker MySQL init

Refresh the bootstrap SQL after schema updates:

```sh
npm --prefix database run generate:init-sql
```
