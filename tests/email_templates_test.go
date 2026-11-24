package mail_test

import (
	"bytes"
	"encoding/json"
	"html/template"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Exercise the Go template language used by Auth, including accounts without locale metadata.
func TestLocalizedMail(t *testing.T) {
	output := t.TempDir()
	command := exec.Command("python3", "../scripts/build-email-templates.py", output)
	if result, err := command.CombinedOutput(); err != nil {
		t.Fatalf("generate: %v: %s", err, result)
	}
	for _, tc := range []struct{ tag, language string }{
		{"en-gb", "en"}, {"cs-cz", "cs"}, {"cs", "cs"}, {"de-ch", "en"}, {"", "cs"},
	} {
		dictionary, err := os.ReadFile("../supabase/templates/" + tc.language + ".json")
		if err != nil {
			t.Fatal(err)
		}
		labels := map[string]string{}
		if err := json.Unmarshal(dictionary, &labels); err != nil {
			t.Fatal(err)
		}
		metadata := map[string]string{}
		if tc.tag != "" {
			metadata["locale"] = tc.tag
		}
		for _, kind := range []string{"confirmation", "recovery", "magic_link"} {
			for _, ext := range []string{"html", "subject.txt"} {
				file := filepath.Join(output, kind+"."+ext)
				tmpl, err := template.ParseFiles(file)
				if err != nil {
					t.Fatal(err)
				}
				const link = "https://example.invalid/confirmation"
				var result bytes.Buffer
				if err := tmpl.Execute(&result, map[string]any{"Data": metadata, "ConfirmationURL": link}); err != nil {
					t.Fatal(err)
				}
				value := result.String()
				if !strings.Contains(value, labels[kind+".title"]) {
					t.Errorf("%s for %q has the wrong title", file, tc.tag)
				}
				if ext == "html" && (!strings.Contains(value, `lang="`+tc.language+`"`) || !strings.Contains(value, link)) {
					t.Errorf("%s for %q has the wrong language or verification URL", file, tc.tag)
				}
			}
		}
	}
}
