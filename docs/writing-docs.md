Writing Documentation
=====================

Generally, APIs and exchanges should be documented with strings in the code, and
schemas referenced should contain detailed `description` properties containing
markdown.

However, it is often necessary to write some text documentation that goes beyond
reference style documentation. For this purposes github flavored markdown
documents can be added to the `docs/` folder.

Files in the `docs/` folder should use dashes as separator in files names, they
should have descriptive filenames as these will be used in URLs. Image files
may also be included along side markdown files in the `docs/` folder and
referenced with relative paths.

Typically, each file will cover a specific topic, like queue-worker interaction,
or how to create your first task. Files in the `docs/` folder **should not**
cover code, deployment, maintenance or test topics, files in the `docs/` folder
are intended to be end-user documentation for service consumers.

Source code, deployment, maintenance and test documentation should be written in
the top-level `README.md` or left as source-code comments.
