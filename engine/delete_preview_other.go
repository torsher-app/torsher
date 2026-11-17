//go:build !linux && !darwin

package main

import "errors"

func reclaimableFileBytes(_ []string) (int64, error) {
	return 0, errors.New("file allocation information is unavailable")
}
