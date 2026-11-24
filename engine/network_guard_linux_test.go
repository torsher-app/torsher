package main

import (
	"net/netip"
	"os"
	"strconv"
	"strings"
	"syscall"
	"testing"
)

func TestNetworkGuardRulesRetainPreviouslyProtectedAddresses(t *testing.T) {
	rules, err := networkGuardRules(
		true,
		guardedInterface{
			Index: 12,
			IPv4:  netip.MustParseAddr("198.18.24.3"),
			IPv6:  netip.MustParseAddr("2001:db8:1::3"),
		},
		[]guardAddress{
			{IP: netip.MustParseAddr("198.18.24.2"), Index: 11},
			{IP: netip.MustParseAddr("2001:db8:1::2"), Index: 11},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"delete table inet torsher_engine_guard\ntable inet torsher_engine_guard",
		"type filter hook postrouting priority 90",
		"elements = { 198.18.24.2, 198.18.24.3 }",
		"elements = { 2001:db8:1::2, 2001:db8:1::3 }",
		"set paths4_11 { type ipv4_addr; elements = { 198.18.24.2 }; }",
		"set paths6_11 { type ipv6_addr; elements = { 2001:db8:1::2 }; }",
		"oif 12 ip saddr @paths4_12 return",
		"oif 12 ip6 saddr @paths6_12 return",
		"ip saddr @protected4 counter drop",
		"ip6 saddr @protected6 counter drop",
	} {
		if !strings.Contains(rules, expected) {
			t.Fatalf("guard rules do not contain %q:\n%s", expected, rules)
		}
	}
}

func TestNetworkGuardRequiresDistinctHostNamespace(t *testing.T) {
	state, err := os.Stat("/proc/self/ns/net")
	if err != nil {
		t.Fatal(err)
	}
	self := strconv.FormatUint(state.Sys().(*syscall.Stat_t).Ino, 10)
	for _, reference := range []string{self, "", "bogus", "0"} {
		if namespace, err := isolatedGuardNamespace(reference); err == nil {
			t.Fatalf("unsafe namespace reference accepted: %q", namespace)
		}
	}
}
