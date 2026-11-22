package nginx

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

//go:embed embed/nginx.zip
var embeddedNginxZip []byte

// EnsureExtracted extracts the embedded official Windows Nginx zip into targetDir
// if nginx.exe does not already exist there.
func EnsureExtracted(targetDir string) error {
	exePath := filepath.Join(targetDir, "nginx.exe")
	if _, err := os.Stat(exePath); err == nil {
		// Ensure essential subdirectories exist even on existing installs
		for _, sub := range []string{"conf", filepath.Join("conf", "conf.d"), "logs", "temp"} {
			_ = os.MkdirAll(filepath.Join(targetDir, sub), 0o755)
		}
		return nil
	}

	if len(embeddedNginxZip) < 1024 {
		return fmt.Errorf("embedded nginx.zip is missing or empty")
	}

	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return fmt.Errorf("create nginx dir: %w", err)
	}

	zr, err := zip.NewReader(bytes.NewReader(embeddedNginxZip), int64(len(embeddedNginxZip)))
	if err != nil {
		return fmt.Errorf("open embedded nginx.zip: %w", err)
	}

	cleanTarget := filepath.Clean(targetDir) + string(os.PathSeparator)

	for _, f := range zr.File {
		// Official nginx-x.y.z.zip contains a top-level "nginx-x.y.z/" directory; strip it.
		parts := strings.SplitN(strings.TrimPrefix(filepath.ToSlash(f.Name), "/"), "/", 2)
		if len(parts) < 2 || parts[1] == "" {
			continue
		}
		rel := filepath.FromSlash(parts[1])
		destPath := filepath.Join(targetDir, rel)
		if !strings.HasPrefix(filepath.Clean(destPath), cleanTarget) {
			return fmt.Errorf("illegal zip path: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(destPath, 0o755); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			return err
		}
		outFile, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		_, copyErr := io.Copy(outFile, rc)
		closeErr := outFile.Close()
		rc.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}

	for _, sub := range []string{"conf", filepath.Join("conf", "conf.d"), "logs", "temp"} {
		if err := os.MkdirAll(filepath.Join(targetDir, sub), 0o755); err != nil {
			return err
		}
	}

	if _, err := os.Stat(exePath); err != nil {
		return fmt.Errorf("nginx.exe not found after extraction: %w", err)
	}
	return nil
}
