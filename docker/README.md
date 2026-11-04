# Run CODO HARNESS for a team

This runs the harness on one office machine and gives the team access over a private VPN. The same files work on a Linux VPS.

## Set up the machine

1. Install Docker Desktop or Colima, and give the VM about 8–10 GB of memory.
2. Install [Tailscale](https://tailscale.com/) on this machine and on each teammate's computer.
3. Turn off sleep in System Settings and keep the machine plugged in.

## Start the harness

```sh
git clone https://github.com/qxh1145/codo-harness
cd codo-harness
cp .env.example .env        # add your API keys and machine name
mkdir repos
git clone <your-project> repos/<your-project>
docker compose up -d --build
tailscale serve --bg 3080
```

## Create the team

1. Read the setup code: `docker compose exec codo cat /data/team/setup-code.txt`
2. Open `https://<machine-name>/team`, enter the code, and create your admin account.
3. Create a channel and enter the repository's folder name, such as `your-project`.
4. Select **+** next to **Team** to make an invitation link for each teammate.

## Connect GitHub

Pull request status and checks need the GitHub CLI signed in once:

```sh
docker compose exec codo gh auth login
```

## Code navigation

The image includes language servers for JavaScript, TypeScript and Java, so agents can jump to definitions and find references instead of searching text.

Outside Docker, install them on the machine and restart the harness:

```sh
npm install -g typescript-language-server typescript@6
brew install jdtls
```

Java needs JDK 25 or newer. If your `JAVA_HOME` points at an older JDK, start the harness with `CODO_LSP_JAVA_HOME` set to a newer one. A language that has no server installed is skipped, and the tool disappears when none is installed.

## Keep it healthy

- Update repositories with `git -C repos/<your-project> pull`. `@codo` reads what is on disk.
- Back up the `codo-data` volume outside this machine. It holds accounts, chat and sessions.
- With FileVault on, someone must log in after a restart before Docker can start.
- Keys in `.env` stay on this machine. Do not paste them into chat.

## Move to a VPS

Install Docker and Tailscale on the VPS, restore the `codo-data` volume, copy `.env`, then run the same commands.
