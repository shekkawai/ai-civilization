# Security policy

Please do not open a public issue for a vulnerability that could expose credentials, private model output, or write access to a running experiment. Use GitHub's private vulnerability reporting for this repository.

Production write routes require `AI_CIVILIZATION_SECRET`. If it is absent, production writes are disabled. Keep provider credentials in environment variables and list only the variables each adapter needs in `coordinator.json`.

The `main` branch is the supported version.
