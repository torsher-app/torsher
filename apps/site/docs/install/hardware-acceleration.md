---
title: Hardware transcoding
description: "Let Torsher transcode video on the GPU: Intel and AMD through VAAPI, NVIDIA through NVENC, and what the CPU does without a GPU."
---

# Hardware transcoding

When a player can't decode a video, the server converts it to H.264 on the fly. A GPU does this many times faster than the CPU and barely loads the server. This page lets the container see your GPU.

::: tip What you'll get
<Ui k="panel.nav.settings panel.settings.nav.playback" /> in the panel shows your GPU under <Ui k="panel.settings.playback.accel.title" />, and transcoding runs on it.
:::

::: info Status
VAAPI, NVENC and the CPU fallback are implemented. Checks on the reference hardware (Intel N150 and NVIDIA RTX 3080) are still in progress. If something here doesn't match what you see, please [open an issue](https://github.com/torsher-app/torsher/issues) with the log.
:::

## When transcoding happens

Most of the time it doesn't: the TV app plays files directly, and browsers get the original video repackaged without re-encoding. The server transcodes only what the player can't decode, for example:

- old Xvid and DivX AVI files;
- HEVC or 10-bit video in a browser;
- HDR on a screen without HDR;
- image subtitles, which are burned into the picture.

A GPU encodes up to 1080p; larger video is scaled down.

## Intel and AMD (VAAPI)

1. Check that the host has a GPU device:

   ```bash
   ls -l /dev/dri
   ```

   You should see `renderD128`. No `/dev/dri` means the host has no driver for the GPU or there is no GPU.

2. Intel graphics from Tiger Lake onwards, including the N100 and N150, encode only in low-power mode. It needs the GuC and HuC firmware on the host: the `firmware-intel-graphics` package on Debian, `linux-firmware` on Ubuntu and most other distributions. Alder Lake-N chips (N100, N150) also need Linux 6.2 or later. Check with:

   ```bash
   uname -r
   ```

3. In `docker-compose.yml`, remove the `#` in front of these lines:

   ```yaml
   devices:
     - /dev/dri:/dev/dri
   ```

4. Recreate the container:

   ```bash
   docker compose up -d
   ```

The container finds the group that owns `/dev/dri` on your system by itself; you don't need to add it.

## NVIDIA (NVENC)

1. Install the NVIDIA driver on the host and check it:

   ```bash
   nvidia-smi
   ```

2. Install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) and register it with Docker, as its install guide describes:

   ```bash
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```

3. In `docker-compose.yml`, remove the `#` in front of the NVIDIA block:

   ```yaml
   runtime: nvidia
   deploy:
     resources:
       reservations:
         devices:
           - driver: nvidia
             count: all
             capabilities: [gpu]
   ```

4. Recreate the container:

   ```bash
   docker compose up -d
   ```

## Without a GPU

The CPU is always available. On start, the server measures how fast the CPU encodes and picks a frame size it can keep up with: larger video is scaled down to 1080p, 720p or 576p. The playback settings show the result under <Ui k="panel.settings.playback.transcode.title" />.

Docker Desktop on macOS and Windows does not pass a GPU into Linux containers, so transcoding runs on the CPU there.

## Check

Open <Ui k="panel.nav.settings panel.settings.nav.playback" /> in the panel. Under <Ui k="panel.settings.playback.accel.title" /> you should see your GPU marked <Ui k="panel.settings.playback.status.working" /> and the codecs it decodes; <Ui k="panel.settings.playback.details" /> shows the method (VAAPI or NVENC) and the device. If you changed something, select <Ui k="panel.settings.playback.check" /> to test again.

<Ui k="panel.settings.playback.useGpu" /> is on by default. Turn it off if the GPU produces artifacts: the CPU encodes instead.

## If something went wrong

- **<Ui k="panel.settings.playback.failed.title" />.** The container can't open the device, the host lacks the GPU firmware, or the kernel is too old. Go through steps 1–2 for your GPU again.
- **<Ui k="panel.settings.playback.noGpu" /> with `/dev/dri` passed through.** Check that the host shows `renderD128` in `ls -l /dev/dri`. On Intel N100 and N150, check the firmware and the kernel version from step 2.
- **NVENC is missing.** Run `docker run --rm --gpus all ubuntu nvidia-smi`. If it fails, the NVIDIA Container Toolkit is not set up yet.
- **HDR looks washed out.** <Ui k="panel.settings.playback.toneMapping" /> shows whether the server converts HDR colors on the GPU, on the CPU or not at all.

## Next

[Setup wizard](/docs/setup/wizard).
