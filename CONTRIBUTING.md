# Contributing to the practice hub

Thank you for helping. This repo is open source under the [Apache License, Version 2.0](LICENSE).

- For anything larger than a small fix, open an issue first so we can agree the approach.
- To report a security problem, do not open an issue: see [SECURITY.md](SECURITY.md).
- Please follow the [code of conduct](CODE_OF_CONDUCT.md).

## Making a change

1. Fork the repository and create a branch from `main`.
2. Check out [Triodian/triodian-install](https://github.com/Triodian/triodian-install) beside this one (the
   provisioning builds on it).
3. Run the checks: `npm test`. To see the hub with three fictional clients, run `npm run dev:e2e` and open
   http://localhost:8790/.
4. Open a pull request against `main`, saying what changed and why.

Never commit client names, domains, account ids, tokens or other secrets, in code or examples. A practice keeps them
in its own `practice/` folder, which git ignores.

By contributing you agree that your contribution is licensed under the Apache License, Version 2.0, as set out in its
section 5.
