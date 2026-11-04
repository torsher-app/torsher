//go:build linux || darwin

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

// Каждая компонента открывается относительно fd без symlink. Замена имени
// родительского каталога больше не перенаправит файловую операцию.
func openMaintenanceDir(path string) (int, error) {
	fd, err := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return -1, errors.New("root_unavailable")
	}
	for _, part := range strings.Split(strings.TrimPrefix(filepath.Clean(path), "/"), "/") {
		if part == "" {
			continue
		}
		next, err := unix.Openat(fd, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		unix.Close(fd)
		if err != nil {
			return -1, errors.New("root_unavailable")
		}
		fd = next
	}
	return fd, nil
}

var maintenanceUnlinkCheckpoint = func(string) error { return nil }

func matchingFile(stat unix.Stat_t, item maintenancePath) bool {
	return stat.Mode&unix.S_IFMT == unix.S_IFREG && uint64(stat.Dev) == item.Device && stat.Ino == item.Inode && stat.Size == item.Size && statMtime(stat) == item.Mtime
}
func safeMaintenanceUnlink(item maintenancePath, staged string) error {
	root, err := openMaintenanceDir(item.Root)
	if err != nil {
		return err
	}
	defer unix.Close(root)
	var rootStat unix.Stat_t
	if unix.Fstat(root, &rootStat) != nil || uint64(rootStat.Dev) != item.RootDevice || rootStat.Ino != item.RootInode {
		return errors.New("root_identity_changed")
	}
	rel, err := filepath.Rel(item.Root, item.Path)
	if err != nil || !isInside(item.Root, item.Path) {
		return errors.New("invalid_path")
	}
	parent, err := unix.Dup(root)
	if err != nil {
		return errors.New("root_unavailable")
	}
	for _, part := range strings.Split(filepath.Dir(rel), string(filepath.Separator)) {
		if part == "." {
			continue
		}
		next, openErr := unix.Openat(parent, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		unix.Close(parent)
		if openErr != nil {
			if errors.Is(openErr, unix.ENOENT) {
				var stagedStat unix.Stat_t
				if errors.Is(unix.Fstatat(root, staged, &stagedStat, unix.AT_SYMLINK_NOFOLLOW), unix.ENOENT) {
					return nil
				}
			}
			return errors.New("parent_unavailable")
		}
		parent = next
	}
	defer unix.Close(parent)

	if err := maintenanceUnlinkCheckpoint("opened"); err != nil {
		return err
	}
	name := filepath.Base(rel)
	// Приватный staging не доступен другим uid. Враждебный процесс с тем
	// же uid не входит в контракт: Unix не имеет unlink-if-inode.
	made := unix.Mkdirat(root, staged, 0700)
	if made != nil && !errors.Is(made, unix.EEXIST) {
		return errors.New("staging_unavailable")
	}
	stage, err := unix.Openat(root, staged, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return errors.New("staging_unavailable")
	}
	defer unix.Close(stage)
	var directory unix.Stat_t
	if unix.Fstat(stage, &directory) != nil || directory.Uid != uint32(unix.Geteuid()) || directory.Mode&0777 != 0700 {
		return errors.New("staging_identity_changed")
	}
	if made == nil && unix.Fsync(root) != nil {
		return errors.New("staging_sync_failed")
	}
	var info unix.Stat_t
	err = unix.Fstatat(stage, "file", &info, unix.AT_SYMLINK_NOFOLLOW)
	if errors.Is(err, unix.ENOENT) {
		err = unix.Fstatat(parent, name, &info, unix.AT_SYMLINK_NOFOLLOW)
		if errors.Is(err, unix.ENOENT) {
			if unix.Unlinkat(root, staged, unix.AT_REMOVEDIR) != nil {
				return errors.New("staging_cleanup_failed")
			}
			if unix.Fsync(root) != nil {
				return errors.New("staging_sync_failed")
			}
			return nil
		}
		if err != nil {
			return errors.New("file_unavailable")
		}
		if !matchingFile(info, item) {
			return errors.New("file_identity_changed")
		}
		if err := maintenanceUnlinkCheckpoint("before_capture"); err != nil {
			return err
		}
		if err = renameMaintenanceNoReplace(parent, name, stage, "file"); err != nil {
			return errors.New("capture_failed")
		}
		if unix.Fsync(parent) != nil || unix.Fsync(stage) != nil {
			return errors.New("capture_sync_failed")
		}
		if unix.Fstatat(stage, "file", &info, unix.AT_SYMLINK_NOFOLLOW) != nil {
			return errors.New("staged_unavailable")
		}
	} else if err != nil {
		return errors.New("staged_unavailable")
	}
	if err := maintenanceUnlinkCheckpoint("captured"); err != nil {
		return err
	}
	if !matchingFile(info, item) {
		if renameMaintenanceNoReplace(stage, "file", parent, name) != nil {
			return errors.New("capture_identity_conflict")
		}
		if unix.Fsync(parent) != nil || unix.Fsync(stage) != nil {
			return errors.New("restore_sync_failed")
		}
		return errors.New("file_identity_changed")
	}
	var recreated unix.Stat_t
	if err := unix.Fstatat(parent, name, &recreated, unix.AT_SYMLINK_NOFOLLOW); !errors.Is(err, unix.ENOENT) {
		return errors.New("source_recreated")
	}
	if err := maintenanceUnlinkCheckpoint("before_unlink"); err != nil {
		return err
	}
	if err = unix.Unlinkat(stage, "file", 0); err != nil {
		return errors.New("unlink_failed")
	}
	if unix.Fsync(stage) != nil {
		return errors.New("unlink_sync_failed")
	}
	if err = unix.Unlinkat(root, staged, unix.AT_REMOVEDIR); err != nil {
		return errors.New("staging_cleanup_failed")
	}
	if unix.Fsync(root) != nil {
		return errors.New("staging_sync_failed")
	}
	return nil
}

// Идентичность имени в каталоге, а не inode файла: внешние hardlinks не блокируем.
func maintenanceEntryKey(path string) string {
	var parent unix.Stat_t
	if unix.Stat(filepath.Dir(path), &parent) != nil {
		return ""
	}
	return fmt.Sprintf("entry:%d:%d:%s", parent.Dev, parent.Ino, filepath.Base(path))
}

// O_NOFOLLOW применяется ко всем компонентам; fstat проверяет именно открытый объект.
func openMaintenanceFile(item maintenancePath) (*os.File, error) {
	root, err := openMaintenanceDir(item.Root)
	if err != nil {
		return nil, err
	}
	defer unix.Close(root)
	var info unix.Stat_t
	if unix.Fstat(root, &info) != nil || uint64(info.Dev) != item.RootDevice || info.Ino != item.RootInode {
		return nil, errors.New("root_identity_changed")
	}
	if !isInside(item.Root, item.Path) {
		return nil, errors.New("invalid_path")
	}
	rel, _ := filepath.Rel(item.Root, item.Path)
	parent, err := unix.Dup(root)
	if err != nil {
		return nil, errors.New("root_unavailable")
	}
	for _, part := range strings.Split(filepath.Dir(rel), string(filepath.Separator)) {
		if part == "." {
			continue
		}
		next, err := unix.Openat(parent, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		unix.Close(parent)
		if err != nil {
			return nil, errors.New("parent_unavailable")
		}
		parent = next
	}
	defer unix.Close(parent)
	fd, err := unix.Openat(parent, filepath.Base(rel), unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, errors.New("file_unavailable")
	}
	if unix.Fstat(fd, &info) != nil || !matchingFile(info, item) {
		unix.Close(fd)
		return nil, errors.New("file_identity_changed")
	}
	return os.NewFile(uintptr(fd), "maintenance-source"), nil
}
