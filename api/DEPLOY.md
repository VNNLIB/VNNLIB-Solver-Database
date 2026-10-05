# Deploying the API

Any WSGI host can serve it: import `api.app:app`. The `app.run()` at the bottom
of `app.py` is for local use only, and paths resolve relative to `api/app.py`, so
the working directory does not matter.

What follows is PythonAnywhere's free tier, which is what the project uses.
`<username>` below is your PythonAnywhere username: your home directory is always
`/home/<username>` and your site is `https://<username>.pythonanywhere.com`.

## First setup

**1. Clone it.** Open Bash console:

```bash
git clone https://github.com/VNNLIB/VNNLIB-Solver-Database.git
mkvirtualenv --python=/usr/bin/python3.12 solverdb
pip install flask
```

**2. Web tab → Add a new web app → Manual configuration**, Python 3.12. Set
**Virtualenv** to `solverdb`.

**3. Edit the WSGI file** (link near the top of the Web tab). Replace its
contents with:

```python
import sys
path = '/home/<username>/VNNLIB-Solver-Database'
if path not in sys.path:
    sys.path.insert(0, path)

from api.app import app as application
```

Import `app`; never call `app.run()` here.

**4. Reload**, then check `https://<username>.pythonanywhere.com/health`.

### Point it at the right database

Still the same WSGI file, not a new one. By default the API serves
`data/solvers.json` from the clone.. To serve something else, add two lines at the end:

```python
import sys
path = '/home/<username>/VNNLIB-Solver-Database'
if path not in sys.path:
    sys.path.insert(0, path)

from api.app import app as application

# the database that collect.yml uploads, outside the clone
import api.app, pathlib
api.app.DATABASE = pathlib.Path('/home/<username>/solvers.json')
```

Or, until there is any collected data, the test fixture. `/health` and `/` then
report `"source": "demo"`:

```python
# the test fixture, until a collection has produced real data
import api.app
api.app.DATABASE = api.app.DEMO_DATABASE
```

`DATABASE` is read on each request, so setting it here is enough. Reload after
any change to this file.

## Keeping it up to date

The data and the code update separately.

| | Where it lives | Updated by | Needs a reload |
|---|---|---|---|
| The database | `/home/<username>/solvers.json`, outside the clone | `collect.yml`, after every collection | No |
| The code | the clone the WSGI file imports from | `deploy-api.yml` on push, and a daily scheduled task | Yes, and both do it |

`database()` re-reads the file when its mtime changes, so an upload is live on
the next request. A running web app holds `app.py` in memory from when it last
started, so new code needs a reload.

### Secrets and variables

Settings → Secrets and variables → Actions.

| Secret | Value |
|---|---|
| `PA_USERNAME` | your PythonAnywhere username |
| `PA_API_TOKEN` | Account page → API Token tab |

Without both, the publish and deploy steps print a skip message and the workflow
carries on.

| Variable | Default | Set it when |
|---|---|---|
| `PA_HOST` | `www.pythonanywhere.com` | your account is on `eu.pythonanywhere.com` |
| `PA_DOMAIN` | `<username>.pythonanywhere.com` | you use a custom domain |
| `PA_APP_DIR` | `VNNLIB-Solver-Database` | the clone is somewhere else |

`PA_APP_DIR` must match the path the WSGI file imports from.

### The data

`collect.yml` uploads the database to `/home/<username>/solvers.json` after every
collection. It lands outside the git clone, so `git pull` on the server never
conflicts with it, and pulling the repository does not change what is served.

### The code

Two automations, so nothing has to be done by hand after the setup above.

**On push:** `deploy-api.yml` uploads everything in `api/` and calls the reload
endpoint, on pushes to `main` touching `api/**`. It then fetches `/` and fails
the job if the new routes are absent, so a deploy into the wrong directory is a
red build rather than a silent no-op. Needs the two secrets above.

It uploads rather than pulls, so it does not cover a new dependency or code the
API imports from outside `api/`. The scheduled task does.

**Daily:** the free tier includes one scheduled task. Schedule tab, once a day:

```bash
cd ~/VNNLIB-Solver-Database && git pull \
  && ~/.virtualenvs/solverdb/bin/pip install -q -r api/requirements.txt \
  && touch /var/www/<username>_pythonanywhere_com_wsgi.py
```

Touching the WSGI file is what Reload does, so this pulls, installs and reloads
on its own. Take the exact filename from the Web tab: it is derived from the
domain.

Between the two, a change to `api/` is live in a minute and anything else within
a day. The only thing left that needs a console is a change you do not want to
wait for, in which case run the command above yourself.

### If a deploy looks like it did nothing

The clone you are looking at may not be the one the WSGI file imports from.
Compare them:

```bash
grep -c vocabulary ~/VNNLIB-Solver-Database/api/app.py
curl -s https://<username>.pythonanywhere.com/ | grep -c vocabulary
```

The path the web app actually uses is in the WSGI file linked at the top of the
Web tab; `PA_APP_DIR` has to match it.

## Free tier limitation

- The web app expires every months until you click the reload button on the Web tab.
