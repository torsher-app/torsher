//go:build !linux

package main

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"syscall"
)

func bindingSupported() bool { return false }

func guardPeerUID(net.Conn) (uint32, error) {
	return 0, errors.ErrUnsupported
}

func serveNetworkGuard(context.Context, string, uint32) error {
	return errors.ErrUnsupported
}

func bindSocketControl(string, netip.Addr, netip.Addr, bool) func(string, string, syscall.RawConn) error {
	return func(string, string, syscall.RawConn) error {
		return errors.ErrUnsupported
	}
}
