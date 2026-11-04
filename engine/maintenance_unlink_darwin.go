package main

import "golang.org/x/sys/unix"

func renameMaintenanceNoReplace(from int, name string, to int, target string) error {
	return unix.RenameatxNp(from, name, to, target, unix.RENAME_EXCL)
}
func statMtime(stat unix.Stat_t) float64 {
	return float64(stat.Mtim.Sec)*1000 + float64(stat.Mtim.Nsec)/1e6
}
