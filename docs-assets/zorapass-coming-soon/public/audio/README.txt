Background music
================

Place your LICENSED audio file here named exactly:

    sete.mp3

Vite serves this folder at the site root, so the file becomes:

    /audio/sete.mp3

which is the path referenced by SONG.src in src/ZoraPassComingSoon.jsx.

The track starts looping when a visitor clicks the sound toggle
(top-right). Browsers block audio with sound until a user gesture, so it
cannot auto-start on load — the toggle is that gesture.

Licensing note: "Sete" (Young Stunna & Blxckie) is a commercial,
copyrighted recording. Using it on a public website requires the
appropriate license / sync rights. Use a copy you are licensed to use.
To swap tracks, drop a different file here and update SONG in the component.
