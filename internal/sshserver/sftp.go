package sshserver

import (
	"io"
	"log"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

func (m *Manager) serveSFTP(channel ssh.Channel) {
	server, err := sftp.NewServer(channel)
	if err != nil {
		log.Printf("[ssh/sftp] init error: %v", err)
		return
	}
	if err := server.Serve(); err != nil && err != io.EOF {
		log.Printf("[ssh/sftp] serve error: %v", err)
	}
	_ = server.Close()
}
