//go:build !linux && !darwin

package main

import (
	"errors"
	"os"
)

func safeMaintenanceUnlink(_ maintenancePath, _ string) error {
	return errors.New("maintenance_platform_unsupported")
}

func maintenanceEntryKey(_ string) string { return "" }

func openMaintenanceFile(_ maintenancePath) (*os.File, error) {
	return nil, errors.New("maintenance_platform_unsupported")
}
