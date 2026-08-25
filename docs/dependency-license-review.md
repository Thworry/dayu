# Dependency license review

DAYU's CI fails closed when `pnpm licenses list --prod` returns a missing, unknown, or newly introduced license. SPDX groups currently accepted by the gate are MIT, ISC, Apache-2.0, BSD-3-Clause, BlueOak-1.0.0, MPL-2.0, and CC-BY-4.0. BlueOak-1.0.0 is a permissive redistribution license used by the reviewed `@fastify/static` dependency tree; it does not impose a copyleft condition on DAYU's Apache-2.0 distribution.

## GitHub Copilot runtime exception

`@github/copilot-sdk@1.0.11` declares MIT. Its runtime dependency `@github/copilot@1.0.80` and the matching platform packages declare `SEE LICENSE IN LICENSE.md`, which pnpm reports as `Unknown`. The bundled GitHub license grants the right to install and run the software and, subject to its conditions, redistribute unmodified copies as part of an application or service. It also states that the surrounding application may use an independent open-source license.

The CI exception is therefore limited to version `1.0.80` of `@github/copilot` and its eight named platform packages. Any name or version change fails the gate and requires a fresh review of the installed `LICENSE.md`; the exception is not a general approval for unknown licenses. GitHub Copilot remains a separately licensed runtime dependency and is not relicensed under DAYU's Apache-2.0 license.
