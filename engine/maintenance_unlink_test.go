//go:build linux || darwin

package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestMaintenanceUnlinkCaptureCrashRetry(t *testing.T) {
	item := maintenanceFixture(t)
	alias := item.Path + ".alias"
	if err := os.Link(item.Path, alias); err != nil {
		t.Fatal(err)
	}
	maintenanceUnlinkCheckpoint = func(step string) error {
		if step == "captured" {
			return errors.New("crash")
		}
		return nil
	}
	t.Cleanup(func() { maintenanceUnlinkCheckpoint = func(string) error { return nil } })
	if safeMaintenanceUnlink(item, ".stage") == nil {
		t.Fatal("injected crash ignored")
	}
	if _, err := os.Stat(filepath.Join(item.Root, ".stage", "file")); err != nil {
		t.Fatal("captured file lost", err)
	}
	maintenanceUnlinkCheckpoint = func(string) error { return nil }
	if err := safeMaintenanceUnlink(item, ".stage"); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(alias); err != nil || string(data) != "synthetic" {
		t.Fatal("external hardlink damaged", err)
	}
	if _, err := os.Stat(item.Path); !os.IsNotExist(err) {
		t.Fatal("owned file remains", err)
	}
}
func TestMaintenanceUnlinkConcurrentReplacement(t *testing.T) {
	item := maintenanceFixture(t)
	old := item.Path + ".old"
	maintenanceUnlinkCheckpoint = func(step string) error {
		if step == "before_capture" {
			if err := os.Rename(item.Path, old); err != nil {
				return err
			}
			return os.WriteFile(item.Path, []byte("foreign"), 0600)
		}
		return nil
	}
	t.Cleanup(func() { maintenanceUnlinkCheckpoint = func(string) error { return nil } })
	if err := safeMaintenanceUnlink(item, ".stage"); err == nil {
		t.Fatal("replacement deleted")
	}
	for path, want := range map[string]string{item.Path: "foreign", old: "synthetic"} {
		data, err := os.ReadFile(path)
		if err != nil || string(data) != want {
			t.Fatalf("file damaged %q: %s %v", path, data, err)
		}
	}
}
func TestMaintenanceUnlinkSymlinkAndUnavailableRoot(t *testing.T) {
	root := t.TempDir()
	folder := filepath.Join(root, "owned")
	if err := os.Mkdir(folder, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(folder, "video")
	if err := os.WriteFile(path, []byte("synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	item := maintenanceIdentity(t, root, path)
	neighbor := t.TempDir()
	if err := os.WriteFile(filepath.Join(neighbor, "video"), []byte("foreign"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(folder, folder+".old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(neighbor, folder); err != nil {
		t.Fatal(err)
	}
	if safeMaintenanceUnlink(item, ".stage") == nil {
		t.Fatal("symlink followed")
	}
	data, err := os.ReadFile(filepath.Join(neighbor, "video"))
	if err != nil || string(data) != "foreign" {
		t.Fatal("neighbor damaged")
	}
	item.RootInode++
	if safeMaintenanceUnlink(item, ".stage") == nil {
		t.Fatal("root mismatch accepted")
	}
}
func TestMaintenanceUnlinkRecreatedSourcePreservesBoth(t *testing.T) {
	item := maintenanceFixture(t)
	stage := filepath.Join(item.Root, ".stage")
	if err := os.Mkdir(stage, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(item.Path, filepath.Join(stage, "file")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(item.Path, []byte("foreign"), 0600); err != nil {
		t.Fatal(err)
	}
	if safeMaintenanceUnlink(item, ".stage") == nil {
		t.Fatal("recreated source ignored")
	}
	for _, path := range []string{item.Path, filepath.Join(stage, "file")} {
		if _, err := os.Stat(path); err != nil {
			t.Fatal("file lost", err)
		}
	}
}

func TestMaintenanceUnlinkParentSwapUsesAnchoredDirectory(t *testing.T) {
	root := t.TempDir()
	folder := filepath.Join(root, "owned")
	if err := os.Mkdir(folder, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(folder, "video")
	if err := os.WriteFile(path, []byte("synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	item := maintenanceIdentity(t, root, path)
	neighbor := t.TempDir()
	if err := os.WriteFile(filepath.Join(neighbor, "video"), []byte("foreign"), 0600); err != nil {
		t.Fatal(err)
	}
	maintenanceUnlinkCheckpoint = func(step string) error {
		if step == "opened" {
			if err := os.Rename(folder, folder+".old"); err != nil {
				return err
			}
			return os.Symlink(neighbor, folder)
		}
		return nil
	}
	t.Cleanup(func() { maintenanceUnlinkCheckpoint = func(string) error { return nil } })
	if err := safeMaintenanceUnlink(item, ".stage"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(neighbor, "video"))
	if err != nil || string(data) != "foreign" {
		t.Fatal("neighbor damaged")
	}
	if _, err := os.Stat(filepath.Join(folder+".old", "video")); !os.IsNotExist(err) {
		t.Fatal("original resource not removed", err)
	}
}

func TestMaintenanceUnlinkForeignStagingNeverOverwritesSource(t *testing.T) {
	item := maintenanceFixture(t)
	stage := filepath.Join(item.Root, ".stage")
	if err := os.Mkdir(stage, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stage, "file"), []byte("foreign"), 0600); err != nil {
		t.Fatal(err)
	}
	if safeMaintenanceUnlink(item, ".stage") == nil {
		t.Fatal("foreign staged file accepted")
	}
	data, err := os.ReadFile(item.Path)
	if err != nil || string(data) != "synthetic" {
		t.Fatal("source overwritten", err)
	}
	data, err = os.ReadFile(filepath.Join(stage, "file"))
	if err != nil || string(data) != "foreign" {
		t.Fatal("foreign staging removed", err)
	}
}
