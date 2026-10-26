---
title: NAS
description: "Install Torsher on a NAS with an x86-64 CPU, such as Unraid, TrueNAS SCALE or an Intel Synology: folders, the file owner, the container settings and the GPU."
---

# NAS

Torsher runs on a NAS as one container, next to the disks that hold your media. Every NAS system creates containers in its own way, so this page lists what Torsher needs and points to your system's documentation for the clicks.

::: tip What you'll get
Torsher running on your NAS, its data in a share you chose, and the control panel open in your browser.
:::

::: info Not verified on each NAS yet
NAS systems on x86 are part of the main target, and they are checked together with testers. The steps on this page haven't been verified on Unraid, TrueNAS SCALE or Synology yet. Where your NAS does something differently, follow its documentation, and please [open an issue](https://github.com/torsher-app/torsher/issues) so this page can be fixed.
:::

## Which NAS works

| NAS | Status |
| --- | --- |
| Unraid, TrueNAS SCALE, and Synology or QNAP models with x86-64 (Intel or AMD) CPUs | Main target, not verified on each system yet |
| NAS with arm64 CPUs | Best effort: the image exists, without guarantees |
| Synology models with Realtek ARM CPUs, 32-bit ARM | Not supported: no image |

The NAS also needs to run Docker containers and have 4 GB of memory or more. See [Requirements](/docs/install/requirements).

How each system runs containers:

- **TrueNAS SCALE** takes a Compose file under **Apps**, with **Install via YAML**. See [Installing Custom Apps](https://apps.truenas.com/managing-apps/installing-custom-apps/) in the TrueNAS docs.
- **Synology** runs Compose files as projects in **Container Manager**. See [Docker on DSM](https://www.synology.com/dsm/feature/docker) and check that your model supports Container Manager.
- **Unraid** runs containers from its **Docker** tab and doesn't support Docker Compose on its own. See [Run Docker containers](https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/overview/). Enter the values from step 3 in its container form.

## Before you start

- Admin access to the NAS, and container support turned on in it.
- A way to run a command on the NAS, such as SSH, to look up user IDs. Your NAS documentation explains how to turn it on.

## 1. Create the folders

Torsher needs one folder on the NAS for `/data`: the database, downloads and the library. Create a share or dataset for it, for example `torsher`, on the pool where your media lives.

If you want the database on a different pool than the big disks, mount two folders, as in [Several disks](/docs/install/docker-compose#several-disks): a small one as `/data` and the big one as `/storage`, with downloads and the library both inside `/storage`.

::: warning Keep downloads and the library in one mounted folder
Kept files are hard-linked from downloads into the library and take no extra space. That only works inside one file system. Two shares or datasets may be separate file systems even on the same pool, and then every kept file is copied and takes space twice. The folder browser in the panel shows whether hard links work: check it before you fill the library.
:::

Keep the database on the NAS's own disks. A folder that the NAS mounts from another machine over the network hasn't been checked for the database.

Your existing movies and series can stay where they are. Mount those folders read-only and add them to the library later; Torsher never writes there.

## 2. Pick the file owner

Torsher writes files as the user in `PUID` and `PGID`. On a NAS these are rarely `1000`. Use the user who owns the folders from step 1, or a user you create for containers.

Find the IDs of a user over SSH:

```bash
id <user>
```

`uid` is `PUID`, and `gid` is `PGID` (the group). That user must be able to read and write the Torsher folders. On start, the container gives its folders to this user where the NAS allows it, and stops with a clear message if it still can't write.

## 3. Create the container

If your NAS takes a Compose file, start from the example file and change three things:

<<< @/../../docker-compose.example.yml{yaml}

1. Replace `./data` with the full path of the folder from step 1 on the NAS.
2. Set `PUID` and `PGID` from step 2, and `TZ` to your time zone, for example `Europe/Berlin`.
3. The `prowlarr` service doesn't start by default. To run it on the NAS too, delete its `profiles: [prowlarr]` line and replace `./prowlarr` with a full path. See [Indexers](/docs/setup/indexers).

If your NAS has a container form instead, enter these values:

| Setting | Value |
| --- | --- |
| Image | `ghcr.io/torsher-app/torsher:latest`, or `torsherapp/torsher:latest` if the NAS searches only Docker Hub |
| Port | `8080` on the NAS to `8080` in the container |
| Folder | the folder from step 1 to `/data` |
| Variables | `PUID`, `PGID`, `TZ` |
| Restart policy | unless stopped |
| Device (optional) | `/dev/dri` to `/dev/dri`, for Intel or AMD graphics |

If port `8080` is taken on the NAS, pick another port on the NAS side, for example `8081`, and keep `8080` on the container side.

## 4. Pass the GPU through (optional)

If the NAS has Intel or AMD graphics, pass `/dev/dri` into the container as a device. The NAS system must have a working driver for the GPU, which depends on the system and its version (not verified). The container finds the group that owns the device by itself. NVIDIA cards need the NVIDIA driver and the NVIDIA Container Toolkit on the NAS.

Details and checks: [Hardware transcoding](/docs/install/hardware-acceleration).

## Check

1. The NAS shows the `torsher` container as running, and within a minute as healthy.
2. On your computer or phone, open `http://<server-address>:8080/panel/`. The panel asks you to create the owner account and starts the [setup wizard](/docs/setup/wizard).
3. The wizard's storage step shows <Ui k="panel.wizard.storage.library.ok" /> and <Ui k="panel.wizard.storage.links.hardlink" />. <Ui k="panel.wizard.storage.links.reflink" /> is fine too.

## If something went wrong

- **The container keeps restarting.** Open its log in the NAS interface. See [Troubleshooting](/docs/troubleshooting#container-restarts).
- **A folder is not writable.** `PUID` and `PGID` don't match the folder's owner. See [Troubleshooting](/docs/troubleshooting#not-writable).
- **The port is taken.** See [Troubleshooting](/docs/troubleshooting#port-in-use).
- **Kept files are copied.** Downloads and the library are on different file systems. See [Troubleshooting](/docs/troubleshooting#copies).
- **The GPU failed the test.** See [Troubleshooting](/docs/troubleshooting#gpu-failed).

## Next

- [Setup wizard](/docs/setup/wizard).
- [Hardware transcoding](/docs/install/hardware-acceleration), if the NAS has a GPU.
