---
section: Included chapter
---

### An included file

This text lives in `chapters/details.md`. It sets its own `section` variable, so the running header on the pages where it appears reads “{{section}}”. It still sees the parent’s variables: the title is “{{title}}”.

Included files can include other files, can be nested in folders, and keep their own images:

../assets/diagram.svg (The same diagram, included from a nested file)
