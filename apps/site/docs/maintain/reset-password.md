---
title: Reset the password
description: "Forgot the owner password? Reset it with a command on the machine where Torsher runs."
---

# Reset the password

Torsher has one account and sends no email, so there is no recovery link. Whoever can run commands on the server sets a new password with one command.

::: tip What you'll get
A new owner password and access to the control panel again.
:::

## Before you start

- A terminal on the machine where the Torsher container runs, with access to Docker.
- The container name. It is `torsher` in the [install file](/docs/install/docker-compose); `docker ps` lists the names.

## 1. Set a new password

```bash
docker exec -it torsher torsher reset-password
```

The command prints the owner username and a new random password: four groups of five letters and digits, without look-alike characters such as `0` and `o`. If your container has another name, put it in place of the first `torsher`.

The same command is shown on the sign-in screen under <Ui k="panel.auth.forgot" />.

::: details Set your own password instead
Pass it on standard input. It must be at least 8 characters:

```bash
printf '%s' '<new-password>' | docker exec -i torsher torsher reset-password --stdin
```

The password stays in your shell history. To avoid that, set a random one with the first command and change it in the panel.
:::

::: tip Forgot the username too?
The same command prints it: the account has no other login. If you set up Torsher before usernames replaced email, your username is the name you entered in the setup wizard.
:::

## 2. Sign in and change it

Sign in to the panel with the new password, then open <Ui k="panel.nav.settings panel.settings.nav.account" /> and set a password you will remember under <Ui k="panel.settings.account.passwordTitle" />.

## What happens to signed-in devices

- **Browsers signed in to the panel** are signed out, including yours. Sign in again with the new password.
- **TVs and other connected devices** keep working: they are connected with their own key, not with the password. To disconnect one, remove it in <Ui k="panel.nav.people" />.

## Check

The panel opens with the new password, and the command printed `The password for <your username> has been reset.`

## If something went wrong

- **`The server has no account yet.`** Nobody has created the owner account. Open `http://<server-address>:8080/panel/` and create it in the [setup wizard](/docs/setup/wizard).
- **`No such container: torsher`.** The container has another name. Find it with `docker ps` and use it in the command.
- **`The password must be at least 8 characters.`** The password passed with `--stdin` is too short.

## Next

- [Backup and move](/docs/maintain/backup): the account and its password are in every backup.
