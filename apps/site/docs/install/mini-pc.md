---
title: Mini PC
description: "Install Torsher on a mini PC such as an Intel N100 or N150 box: Linux, Docker Engine with the Compose plugin, the GPU and the first start."
---

# Mini PC

A small Intel N100 or N150 computer is a good home for Torsher: it is quiet, uses little power and has a GPU that can transcode video. This page takes it from a blank disk to Docker, then hands over to the Torsher install itself.

::: tip What you'll get
A mini PC running Linux and Docker, its GPU ready for hardware transcoding, and Torsher started with Docker Compose.
:::

## Before you start

- **A mini PC with an Intel N100 or N150.** An N150 mini PC is one of the reference machines Torsher is checked on. Other x86-64 computers work the same way.
- **Memory:** 4 GB or more.
- **Disks:** the system disk, plus room for what you watch and keep. A second internal or USB disk works too; see [Several disks](/docs/install/docker-compose#several-disks).
- A USB stick for the Linux installer, and a screen and keyboard for the install.
- The mini PC connected to your home network.

## 1. Install Linux

Install **Ubuntu Server 24.04 LTS** or **Debian 13**. Follow the official guides:

- [Install Ubuntu Server](https://ubuntu.com/tutorials/install-ubuntu-server)
- [Debian installation guide](https://www.debian.org/releases/stable/installmanual)

The version matters for the GPU. N100 and N150 graphics can encode video only on Linux 6.2 or later. Ubuntu 24.04 ships Linux 6.8 and Debian 13 ships Linux 6.12, so both are fine. Debian 12 (Linux 6.1) and Ubuntu 22.04 (Linux 5.15) are too old out of the box: Torsher still runs on them, but transcodes on the CPU.

While installing, turn on the SSH server if the installer offers it, so you can run the rest of the commands from your computer.

After the install, give the mini PC a fixed address in your router (often called a DHCP reservation). TVs and the panel then always find the server at the same address.

## 2. Install Docker Engine

Follow Docker's guide for your system. It installs Docker Engine together with the Compose plugin, which Torsher needs:

- [Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Install Docker Engine on Debian](https://docs.docker.com/engine/install/debian/)

Use the **apt repository** method from that guide. Docker then starts on its own every time the mini PC boots.

::: details The quick way: Docker's convenience script
Docker also offers a script that sets everything up in one go. Docker itself does not recommend it for production machines, and its default install can bring in a new major Docker version without asking. Read the convenience script section of [Docker's guide](https://docs.docker.com/engine/install/ubuntu/) first.

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
```

```bash
sudo sh get-docker.sh
```
:::

Check that Docker and the Compose plugin are installed:

```bash
docker compose version
```

## 3. Run Docker without sudo

By default, only `root` can run `docker`. Add your user to the `docker` group:

```bash
sudo usermod -aG docker $USER
```

Log out and back in, then check:

```bash
docker run hello-world
```

::: warning The docker group is an admin group
Anyone in the `docker` group has root-level access to the machine. Add only your own user. See [Docker's post-install steps](https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user). If you'd rather not, keep typing `sudo` in front of `docker` commands.
:::

## 4. Prepare the GPU

1. Check that the system sees the GPU:

   ```bash
   ls -l /dev/dri
   ```

   You should see `renderD128`.

2. Install the Intel graphics firmware and check the kernel version, as described in [Hardware transcoding](/docs/install/hardware-acceleration#intel-and-amd-vaapi), step 2.

## 5. Start Torsher

Follow [Docker Compose](/docs/install/docker-compose) from the first step. On a mini PC, also remove the `#` in front of these lines in `docker-compose.yml`, so the container can use the GPU:

```yaml
devices:
  - /dev/dri:/dev/dri
```

## Check

1. In the folder with `docker-compose.yml`, run:

   ```bash
   docker compose ps
   ```

   The `torsher` container should be `running`, and within a minute `healthy`.

2. On your computer or phone, open `http://<server-address>:8080/panel/`. Find the address with `hostname -I` on the mini PC.
3. After the setup wizard, open <Ui k="panel.nav.settings panel.settings.nav.playback" />: under <Ui k="panel.settings.playback.accel.title" /> you should see the Intel GPU marked <Ui k="panel.settings.playback.status.working" />.

## If something went wrong

- **`docker` says permission denied.** You haven't logged out and back in since adding your user to the `docker` group.
- **The container keeps restarting.** See [Troubleshooting](/docs/troubleshooting#container-restarts).
- **The panel doesn't open from another device.** See [Troubleshooting](/docs/troubleshooting#panel-unreachable).
- **The GPU is missing or failed the test.** Check the firmware and the kernel version, then see [Troubleshooting](/docs/troubleshooting#gpu-failed).

## Next

- [Setup wizard](/docs/setup/wizard).
- [Connect a device](/docs/tv/connect).
