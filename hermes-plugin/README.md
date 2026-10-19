# manufact-crm

Hermes Agent plugin (Agent Plugins v1) za Manufact CRM MCP. Povezuje produkcijski server `https://keen-forge-ldf39.run.mcp-use.com/mcp` i skill `crm-kandidatensuche`.

Token ne stoji u pluginu. Hermes ga uzima iz profila.

```text
CRM_MCP_SERVER_TOKEN=...
```

Upiši tu liniju u `~/.hermes/.env`. Dijeljeni server token je samo za čitanje. Izmjena, restore i odobrenje traže korisnički access token koji server mapira na `crm:write`. Zamijeni vrijednost iste varijable tim tokenom; ne stavljaj ga u `mcp.json`.

Instalacija iz GitHuba, kad je ovaj folder na grani koju Hermes klonira:

```text
hermes plugins install dsactivi-2/Manufact-DB-Roleback-MCP/hermes-plugin --enable
```

Hermes bez `--ref` uzima default granu repoa. Dok plugin živi samo na `feature/cloudflare-read-gateway-20261007`, kolega ga instalira sa punim SHA-om tog commita:

```text
hermes plugins install dsactivi-2/Manufact-DB-Roleback-MCP/hermes-plugin --ref <40-hex-sha> --enable
```

Taj `--ref` pin drži tu verziju. `hermes plugins update manufact-crm` je ne pomjera. Nova verzija je novi puni SHA i ista komanda sa `--force --ref`. Kad folder dođe na default granu i instalacija nije pinovana, `hermes plugins update manufact-crm` povlači zadnji commit te grane. Poslije updatea treba nova Hermes sesija. Token u `.env` ostaje.

Lokalna instalacija iz raspakovanog foldera:

```text
hermes plugins install ./hermes-plugin --enable
```

Alat se zove `mcp__crm__` plus ime iz servera, na primjer `mcp__crm__crm_search_kandidaten`. Ako u `config.yaml` već postoji MCP server `crm`, taj unos ima prednost i ovaj se preskače.

Čitanja prolaze bez dodatnog pitanja jer su označena kao read-only. Svaki alat koji mijenja CRM Hermes pita prije poziva (`trust: untrusted`) i odbija ga kad nema kome da pita.
