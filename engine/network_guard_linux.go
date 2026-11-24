package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

const (
	guardTableName     = "torsher_engine_guard"
	guardHostNamespace = "ENGINE_BIND_HOST_NETNS_INODE"
)

func bindingSupported() bool { return true }

func guardPeerUID(conn net.Conn) (uint32, error) {
	unixConn, ok := conn.(*net.UnixConn)
	if !ok {
		return 0, errors.New("expected a Unix socket")
	}
	raw, err := unixConn.SyscallConn()
	if err != nil {
		return 0, err
	}
	var cred *unix.Ucred
	var sockErr error
	if err := raw.Control(func(fd uintptr) {
		cred, sockErr = unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
	}); err != nil {
		return 0, err
	}
	if sockErr != nil {
		return 0, sockErr
	}
	return cred.Uid, nil
}

func isolatedGuardNamespace(hostInode string) (string, error) {
	expected, err := strconv.ParseUint(hostInode, 10, 64)
	if err != nil || expected == 0 {
		return "", fmt.Errorf("%s must contain the Docker host network namespace inode", guardHostNamespace)
	}
	actual, err := os.Stat("/proc/self/ns/net")
	if err != nil {
		return "", err
	}
	if actual.Sys().(*syscall.Stat_t).Ino == expected {
		return "", errors.New("network helper rejects the host network namespace")
	}
	return os.Readlink("/proc/self/ns/net")
}

func serveNetworkGuard(ctx context.Context, path string, uid uint32) error {
	if os.Geteuid() != 0 || uid == 0 {
		return errors.New("network helper requires root and a non-root engine UID")
	}
	namespace, err := isolatedGuardNamespace(os.Getenv(guardHostNamespace))
	if err != nil {
		return err
	}
	dir, err := os.Stat(filepath.Dir(path))
	if err != nil {
		return err
	}
	if !dir.IsDir() || dir.Mode().Perm()&022 != 0 || dir.Sys().(*syscall.Stat_t).Uid != 0 {
		return errors.New("network helper socket directory must belong to root and disallow writes by other users")
	}
	if prior, err := os.Lstat(path); err == nil {
		if prior.Mode()&os.ModeSocket == 0 || prior.Sys().(*syscall.Stat_t).Uid != 0 {
			return errors.New("network helper socket path is already occupied")
		}
		active, dialErr := net.DialTimeout("unix", path, 100*time.Millisecond)
		if dialErr == nil {
			_ = active.Close()
			return errors.New("network helper is already running")
		}
		if !errors.Is(dialErr, syscall.ECONNREFUSED) {
			return dialErr
		}
		if err := os.Remove(path); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	nftPath, err := exec.LookPath("nft")
	if err != nil {
		return err
	}
	server, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return err
	}
	defer server.Close()
	if err := os.Chmod(path, 0660); err != nil {
		return err
	}
	stop := context.AfterFunc(ctx, func() { _ = server.Close() })
	defer stop()
	for {
		conn, err := server.AcceptUnix()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		handleGuardRequest(ctx, conn, nftPath, namespace, uid)
	}
}

func handleGuardRequest(ctx context.Context, conn *net.UnixConn, nftPath, namespace string, uid uint32) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	if peerUID, err := guardPeerUID(conn); err != nil || peerUID != uid {
		return
	}
	var req guardRequest
	if json.NewDecoder(io.LimitReader(conn, 1024)).Decode(&req) != nil || !validBindInterface(req.Interface) {
		return
	}
	device, status := interfaceForBinding(req.Interface)
	reply := guardResponse{Namespace: namespace, Status: status, Device: device}
	if status == "bound" {
		ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
		defer cancel()
		if err := installNetworkGuard(ctx, nftPath, device); err != nil {
			slog.Warn("network helper could not install protection", "interface", req.Interface, "err", err)
			reply.Status = "permission_denied"
		}
	}
	_ = json.NewEncoder(conn).Encode(reply)
}

type guardAddress struct {
	IP    netip.Addr
	Index int
}

type nftObject struct {
	Table *struct {
		Family string
		Name   string
	}
	Set *struct {
		Name string
		Elem []json.RawMessage
	}
}

func nftRead(ctx context.Context, path string, args ...string) ([]nftObject, error) {
	output, err := exec.CommandContext(ctx, path, append([]string{"-j", "-n"}, args...)...).Output()
	if err != nil {
		return nil, err
	}
	var result struct {
		Nftables []nftObject
	}
	err = json.Unmarshal(output, &result)
	return result.Nftables, err
}

func installNetworkGuard(ctx context.Context, path string, device guardedInterface) error {
	tables, err := nftRead(ctx, path, "list", "tables")
	if err != nil {
		return err
	}
	exists := slices.ContainsFunc(tables, func(obj nftObject) bool {
		return obj.Table != nil && obj.Table.Name == guardTableName && obj.Table.Family == "inet"
	})
	var protected []guardAddress
	if exists {
		objects, err := nftRead(ctx, path, "list", "table", "inet", guardTableName)
		if err != nil {
			return err
		}
		for _, obj := range objects {
			if obj.Set == nil {
				continue
			}
			family, indexText, ok := strings.Cut(obj.Set.Name, "_")
			if !ok || (family != "paths4" && family != "paths6") {
				continue
			}
			index, err := strconv.Atoi(indexText)
			if err != nil || index <= 0 {
				return errors.New("invalid interface index in the network guard")
			}
			for _, elem := range obj.Set.Elem {
				var ip netip.Addr
				if err := json.Unmarshal(elem, &ip); err != nil || !ip.IsValid() || ip.Is4() != (family == "paths4") {
					return errors.New("invalid address in the network guard")
				}
				protected = append(protected, guardAddress{IP: ip, Index: index})
			}
		}
	}
	rules, err := networkGuardRules(exists, device, protected)
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, path, "-f", "-")
	cmd.Stdin = strings.NewReader(rules)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("apply nftables rules: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func networkGuardRules(exists bool, device guardedInterface, previous []guardAddress) (string, error) {
	paths := make(map[netip.Addr]int, len(previous)+2)
	for _, path := range previous {
		paths[path.IP] = path.Index
	}
	for _, addr := range []netip.Addr{device.IPv4, device.IPv6} {
		if addr.IsValid() {
			paths[addr] = device.Index
		}
	}
	if len(paths) > 1024 {
		return "", errors.New("too many protected addresses")
	}
	addresses := make([]netip.Addr, 0, len(paths))
	for addr := range paths {
		addresses = append(addresses, addr)
	}
	slices.SortFunc(addresses, netip.Addr.Compare)

	var rules bytes.Buffer
	if exists {
		fmt.Fprintf(&rules, "delete table inet %s\n", guardTableName)
	}
	fmt.Fprintf(&rules, "table inet %s {\n", guardTableName)
	families := []struct {
		suffix, typ, protocol string
		bits                  int
	}{
		{"4", "ipv4_addr", "ip", 32},
		{"6", "ipv6_addr", "ip6", 128},
	}
	var allowed []string
	for _, group := range families {
		var ips []string
		byInterface := make(map[int][]string)
		for _, ip := range addresses {
			if ip.BitLen() == group.bits {
				index := paths[ip]
				ips = append(ips, ip.String())
				byInterface[index] = append(byInterface[index], ip.String())
			}
		}
		writeGuardSet(&rules, "protected"+group.suffix, group.typ, ips)
		indices := make([]int, 0, len(byInterface))
		for index := range byInterface {
			indices = append(indices, index)
		}
		slices.Sort(indices)
		for _, index := range indices {
			name := fmt.Sprintf("paths%s_%d", group.suffix, index)
			writeGuardSet(&rules, name, group.typ, byInterface[index])
			allowed = append(allowed, fmt.Sprintf("oif %d %s saddr @%s return", index, group.protocol, name))
		}
	}
	// После закрытия сокета kernel TCP RST не несёт привязку к интерфейсу.
	// Для старых адресов сохраняем исходный путь, в том числе LAN-ответы
	// сервера, когда этот адрес раньше использовался для привязки движка.
	rules.WriteString("chain egress { type filter hook postrouting priority 90; policy accept;\n")
	rules.WriteString("oifname \"lo\" return\n")
	for _, rule := range allowed {
		fmt.Fprintln(&rules, rule)
	}
	rules.WriteString("ip saddr @protected4 counter drop\nip6 saddr @protected6 counter drop\n}\n}\n")
	return rules.String(), nil
}

func writeGuardSet(rules *bytes.Buffer, name, typ string, addresses []string) {
	fmt.Fprintf(rules, "set %s { type %s;", name, typ)
	if len(addresses) > 0 {
		fmt.Fprintf(rules, " elements = { %s };", strings.Join(addresses, ", "))
	}
	rules.WriteString(" }\n")
}

func bindSocketControl(iface string, ipv4, ipv6 netip.Addr, source bool) func(string, string, syscall.RawConn) error {
	return func(network, _ string, raw syscall.RawConn) error {
		var sockErr error
		if err := raw.Control(func(fd uintptr) {
			sockErr = unix.BindToDevice(int(fd), iface)
			if sockErr != nil || !source {
				return
			}
			switch {
			case strings.HasSuffix(network, "4") && ipv4.IsValid():
				sockErr = unix.Bind(int(fd), &unix.SockaddrInet4{Addr: ipv4.As4()})
			case strings.HasSuffix(network, "6") && ipv6.IsValid():
				sockErr = unix.Bind(int(fd), &unix.SockaddrInet6{Addr: ipv6.As16()})
			default:
				sockErr = syscall.EAFNOSUPPORT
			}
		}); err != nil {
			return err
		}
		return sockErr
	}
}
