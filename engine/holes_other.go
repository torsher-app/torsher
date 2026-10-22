//go:build !unix

package main

// Без `SEEK_HOLE` дыры не найти: проверка разреженных файлов пропускается
func fileHoles(string) ([]extent, error) {
	return nil, nil
}
