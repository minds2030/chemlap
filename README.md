# ChemLab Academy – Netlify deploy
Static frontend (`public/`) + one Netlify Function (`netlify/functions/api.mjs`) + Netlify Blobs (built-in storage, no external DB).

## Deploy
1. Push this folder to GitHub, then Netlify → Add new site → Import from Git (or: `npm i -g netlify-cli && netlify deploy --prod`).
2. Site settings → Environment variables:
   - `ADMIN_PASSWORD` = your teacher password
   - `SECRET` = long random string (e.g. `openssl rand -hex 32`)
3. Redeploy. Open `/#/admin/students` and log in.
4. Settings tab: set your Etisalat wallet number and price. Add stages/grades/units, then videos and questions.
Local dev: `netlify dev` (needs the same env vars in a `.env` file).
