package firewall

import "testing"

func TestFirewallValidation(t *testing.T) {
	validPorts := []string{"80", "443", "8000-8010", "80,443,8080-8090"}
	for _, p := range validPorts {
		if _, err := ValidatePortSpec(p); err != nil {
			t.Errorf("expected valid port %q, got err: %v", p, err)
		}
	}

	invalidPorts := []string{"", "0", "65536", "9000-8000", "80; calc.exe", "abc"}
	for _, p := range invalidPorts {
		if _, err := ValidatePortSpec(p); err == nil {
			t.Errorf("expected invalid port %q to fail", p)
		}
	}

	validAddrs := []string{"", "Any", "*", "192.168.1.10", "10.0.0.0/24, 1.2.3.4"}
	for _, a := range validAddrs {
		if _, err := ValidateRemoteAddress(a); err != nil {
			t.Errorf("expected valid addr %q, got err: %v", a, err)
		}
	}

	invalidAddrs := []string{"999.999.1.1", "10.0.0.0/99", "1.2.3.4; whoami"}
	for _, a := range invalidAddrs {
		if _, err := ValidateRemoteAddress(a); err == nil {
			t.Errorf("expected invalid addr %q to fail", a)
		}
	}

	if !portMatchesSpec(8085, "80,8080-8090") {
		t.Error("expected 8085 to match 80,8080-8090")
	}
	if portMatchesSpec(8085, "80,443") {
		t.Error("expected 8085 not to match 80,443")
	}
}
