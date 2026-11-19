# NextUp · Referência técnica

O pormenor de cada peça. Para a visão geral, a instalação e o uso, ver o [README](../README.md).

- [As peças](#as-peças)
- [Dados em disco](#dados-em-disco)
- [API do gestor](#api-do-gestor)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Dados de demonstração e capturas](#dados-de-demonstração-e-capturas)
- [Linha de comandos da `NextUp.exe`](#linha-de-comandos-da-nextupexe)
- [Compilar, testar e publicar](#compilar-testar-e-publicar)

## As peças

```
mod/      mod do Claude Code, carregado em todos os chats novos (TypeScript)
app/      NextUp.exe: pílula, quadro, janela do gestor, bandeja, tecla de menu (C#, .NET 9, WPF + WebView2)
gestor/   servidor (Node, sem dependências) e interface web
skills/   a skill do orquestrador
bar/      a barra antiga em PowerShell, só como reserva
docs/     esta referência e os desenhos e planos antigos
```

### Mod (`mod/`)

Mod do Claude Code carregado em todos os chats novos. Em cada fim de turno:

- escreve o estado do chat em `%USERPROFILE%\.claude\nextup\itens\`;
- classifica-o com um modelo pequeno (Haiku): importância de 1 a 5, tipo (aprovação, decisão, revisão ou
  informação), esforço (segundos, minutos ou longo), se desbloqueia o chat, um rótulo e o cartão (o que
  pediste, o que fez, o que precisa de ti);
- pede também o que ficou **feito** e o que **falta**, com prioridade, e guarda-o em `situacao\<sessão>.json`
  (não expira, e o feito acumula-se);
- pede se o chat **precisa de ti** e um resumo simples do que estava a fazer, onde ficou e o que falta; um chat
  que não precisa de ti vai para «Terminou» em vez de «À tua espera»;
- se no pedido deixaste algo **para depois** («depois faço», «lembra-me»), guarda um lembrete em
  `lembretes\<sessão>.json` e tira o chat da espera até lá;
- publica a fila ordenada em `barra.json`;
- regista os limites de uso da conta em `consumo\<AAAA-MM-DD>.json`.

Enquanto o chat trabalha, pede à IA, no máximo de 30 em 30 s e sempre que o passo do plano muda, um **título
explicativo**, o que está a fazer **agora** e o que vai precisar de ti. Se o chat parar a meio do turno à tua
espera (uma pergunta, aprovar o plano, uma permissão), isso é publicado logo. De 20 em 20 s responde também aos
pedidos de **ponto de situação dos projetos** que o gestor deixa em `projetos-ia\`.

No chat orquestrador é também o **carteiro**: entrega as mensagens que o gestor deixa em `saida\` (ver
[Orquestrador](#orquestrador)). O mod já não desenha nada dentro do Claude: a faixa por cima da caixa de
texto saiu; a pílula e o gestor mostram a fila.

O mod recarrega no fim do turno de cada chat (`CLAUDE_CODE_PLUGIN_DIR_WATCH=1`): uma mudança no código ou no
prompt da classificação só se vê no turno seguinte, e os chats abertos antes mantêm o mod antigo até
acabarem um turno. Os itens duram 7 dias.

### App (`NextUp.exe`)

App para Windows (C#, .NET 9, WPF e WebView2).

- **Pílula** no canto inferior direito: o logo, quantos esperam e quantos trabalham. Com o rato em cima abre
  um **quadro** com os chats à espera, os que estão a trabalhar com o progresso, e os botões Próximo e
  Gestor. A pílula é uma janela que nunca ganha o foco: clicar nela não tira o foco ao Claude.
- **Gestor numa janela própria**: a página do servidor dentro do WebView2, sem o Edge. O Abrir e o Novo chat
  do gestor põem a app do Claude à frente.
- **Ícone na bandeja**: um clique abre o gestor; o menu tem mostrar a pílula, reiniciar o servidor, ver o
  registo, iniciar com o Windows, reiniciar e sair.
- **Tecla de menu** (`VK_APPS`, ao lado da Copilot): um toque abre o gestor maximizado e outro toque
  esconde-o; segurar cerca de 1 s mostra ou esconde a pílula. Com o gestor aberto a pílula sai do ecrã e
  volta quando ele fecha; fechar ou minimizar a janela do gestor conta como fechá-lo. Enquanto a app corre, a
  tecla de menu não faz mais nada.

**Robustez.** O atalho de arranque corre `NextUp.exe` sem argumentos, que é um *guardião*: arranca `NextUp.exe
--app` e arranca-a de novo se ela morrer (erro fatal, morta no Gestor de Tarefas), com espera crescente se
cair em ciclo. Sair pela bandeja (ou `NextUp.exe --sair`) acaba com ambos. A app cuida do servidor do gestor:
adota o que já corre, arranca outro se faltar e reinicia o que deixar de responder (só depois de 4
verificações seguidas sem resposta). O gancho da tecla corre num fio só seu e é reinstalado de 10 em 10
minutos (o Windows tira ganchos lentos em silêncio). Um segundo `NextUp.exe` só pede ao primeiro para abrir o
gestor. Os erros e a vida da app ficam em `nextup\app.log` (roda aos 512 KB).

O servidor do gestor é procurado em `gestor\servidor.mjs` a partir da pasta do `.exe` para cima (até 6
níveis); `NEXTUP_PROJETO` força a raiz.

### Gestor (`gestor/`)

`servidor.mjs` (Node, sem dependências, só em `127.0.0.1:4730`; se a porta estiver ocupada usa a seguinte
livre) junta os ficheiros de sessão da app (`%APPDATA%\Claude\claude-code-sessions`, só leitura) com a fila do
mod e serve a interface de `gestor/web/`. A porta e o `pid` ficam em `nextup\gestor.json`; os erros em
`nextup\gestor-erros.log`; `/api/saude` responde ao guardião da app.

#### Painel

No topo, **O teu ponto de situação**: a IA resume tudo (o que te espera, o que acabou, o que anda sozinho, os
projetos esquecidos e os lembretes) e diz por onde começar; reescreve-o quando alguma coisa muda. Depois,
À tua espera (cartões por ordem da IA: o que o chat estava a fazer e o que precisa de ti; os chats parados a meio
do turno à tua espera vêm primeiro, e os lembretes que chegaram à hora logo a seguir aos urgentes), **Terminou**
(chats que acabaram sem precisar de ti, com o que terminaram e o que falta, durante 2 dias), a trabalhar (o
título da IA, o que está a fazer agora, o que vai precisar de ti, a lista de tarefas e a última ferramenta),
recentes (todos os chats pela última mensagem) e o medidor do consumo (semana, sessão de 5 h,
previsão). Os Recentes têm **filtros** (à espera, a trabalhar, parados), **ordenar** (última mensagem, mais
antigos, nome, grupo) e **procurar**; o filtro e a ordem ficam guardados no navegador.

Cada chat tem uma ficha com Abrir, Ver grupo e **Dispensar**. Dispensar esconde o chat da fila
(ou do «a trabalhar» ou de «Terminou») só até ao turno seguinte. **Já está feito** tira-o da espera e regista no
projeto que o fizeste (`POST /api/ja-feito`). Um chat onde fizeste `/clear` (a app largou a sessão do CLI
depois de o item começar) sai sozinho de todo o lado. Os lembretes têm **Feito**, **Amanhã** e **Daqui a 3
dias** (`POST /api/lembrete`).

Um chat que acabou o turno mas deixou **subagentes ou workflows a correr em fundo** continua «a trabalhar»
(com a nota «a aguardar N tarefas em fundo») e só passa a «à espera» quando o modelo acordar com o resultado e
voltar a parar. Um script ou build em fundo conta durante 10 min; passado isso assume-se um servidor e o chat volta a «à espera».
Monitores em fundo não contam: podem correr para sempre com o chat à tua espera.

Chats **arquivados** na app nunca contam: nem na fila, nem nos projetos, nem na pílula (a pílula dispensa-os
sozinha).

#### Projetos

Ao abrir uma pasta da árvore da esquerda, o gestor mostra um quadrado por grupo dessa pasta, organizados
pelas subpastas (o Painel não os mostra). No topo há:

- **filtros**: à tua vez, esquecidos, ativos hoje, a arrefecer, parados, sem importância, cada um com quantos
  mostra;
- **ordenar**: o que pede mais atenção, mexidos há menos tempo, parados há mais tempo, mais coisas por fazer,
  prioridade mais alta, nome;
- **procurar**: no nome e no texto do feito e do que falta.

Cada quadrado mostra o **ponto de situação escrito pela IA** em 2 a 4 frases (o que é, o que está resolvido,
onde parou), **a tua vez** (com «✓ Já fiz») e **a seguir**. O gestor junta o material de cada projeto e, de 20 em
20 s mesmo com a janela fechada, deixa um pedido em `projetos-ia\<id>.pedido.json` quando ele muda; o mod de
um chat aberto responde em `projetos-ia\<id>.json`. Enquanto não há texto da IA, o quadrado mostra as listas: o
que ficou **feito**, o que **falta** (por prioridade: a tua vez primeiro, depois a prioridade, e o que ficou parado há
mais tempo sobe um pouco) e o **ritmo**: ativo hoje, a arrefecer, parado, ou esquecido (parado há 7 dias ou
mais e com coisas por fazer). A árvore põe um ponto ao lado das pastas e grupos com um projeto esquecido.

Os quadrados não mostram nomes de chats: só ao carregar no quadrado abre o detalhe, com tudo o que falta e o
que ficou feito (com a prioridade e de que chat vem), as tuas mensagens por dia nos últimos 14 dias e os
chats do grupo. O **×** do quadrado dispensa o projeto até haver uma mensagem nova num chat dele (fica em
«Dispensados», onde se repõe). No detalhe há ainda **Sem importância** (fica à vista mas em último e sem
avisos de esquecido) e um × em cada linha para esconder o que já não vale. Estas marcas são só do gestor
(`nextup\projetos-marcas.json`; `POST /api/projeto`).

O feito e o que falta vêm, por ordem de qualidade, da situação que o mod pede à IA em cada fim de turno, da
lista de tarefas do chat (reconstruída do fim da transcrição, `gestor/lib/continuidade.mjs`) e do cartão da
IA e do resumo da app. Só lê os 4 chats mais recentes de cada grupo (`/api/projetos`). Os chats antigos só
ganham feito e falta da IA quando tiverem um turno novo.

#### Organização

A árvore são os **grupos da barra lateral do Claude** (lidos de `%APPDATA%\Claude\claude_desktop_config.json`,
só leitura e só os grupos), com **pastas do gestor** para os juntar e arrastar (`nextup\organizacao.json`).
As pastas e a ordem são só do gestor: no Claude não muda nada, e o gestor não inventa secções.

#### Consumo

A aba Consumo reconstrói o histórico de tokens a partir das transcrições do Claude Code
(`~/.claude/projects`; só contagens, horas e pastas) e mostra:

- o custo equivalente na API (preços em `gestor/precos.json`), em dólares e em euros (taxa do BCE à vista);
- as horas de uso ativo e passivo;
- a poupança face à subscrição: o valor mensal é o que escreves na aba (fica em `nextup\consumo-config.json`),
  porque o NextUp não deteta o plano;
- as horas de ponta (`gestor/ponta.json`; não há regra oficial em vigor): mapa de calor e excesso medido com
  as leituras do mod.

As transcrições que o Claude Code apagar (limpeza das antigas) continuam a contar: o gestor guarda o que já
leu no índice e nunca o remove.

#### Novo chat e paleta

Novo chat (`claude://code/new`, numa pasta à escolha) e a paleta de comandos (Ctrl+K) para procurar chats,
grupos e ações. O gestor não tem botões para enviar mensagens a chats (ver [Orquestrador](#orquestrador)).

### Orquestrador

Chat dedicado na app que usa a skill [`skills/orquestrar/SKILL.md`](../skills/orquestrar/SKILL.md) (copia-a
para `~/.claude/skills/orquestrar/`): dá pontos de situação e envia mensagens a todos ou a alguns chats,
sempre com confirmação. O seu id está em `nextup\orquestrador.json` e fica fora da fila.

O gestor já não tem botão **Mensagem**: o envio pelo carteiro (pedidos em `saida\`, rotas `/api/mensagens/*`
e o mod do orquestrador) nunca entregou nada (testado a 3 de novembro de 2026), porque o modo automático do
Claude recusa os envios que partem de um mod («sem veredicto»). O código do carteiro ficou, sem nada na
interface que o use. Para enviar a um chat, pede-o ao orquestrador, que o faz com a própria ferramenta e a tua
confirmação.

### Barra antiga (`bar/nextup-barra.ps1`)

A barra em PowerShell, só como reserva (faz o mesmo com a janela Edge `--app`; usa o mesmo mutex, por isso
nunca correm as duas). Foi trocada pelo `NextUp.exe` porque um processo PowerShell com a interface WPF morria
sem deixar rasto.

## Dados em disco

Tudo em `%USERPROFILE%\.claude\nextup\`:

| Ficheiro | O quê |
|---|---|
| `itens\` | um por chat (expira aos 7 dias) e as dispensas `*.dispensado.json` |
| `barra.json` | a fila publicada pelo mod (à espera e a trabalhar) |
| `situacao\<sessão>.json` | o feito e o que falta por chat (não expira) |
| `lembretes\<sessão>.json` | o que deixaste para depois e quando volta |
| `projetos-ia\` | os pedidos de ponto de situação (`*.pedido.json`) e as respostas da IA |
| `consumo\` | os limites de uso por dia; `consumo\historico\` é o índice das transcrições |
| `consumo-config.json` | a subscrição, para a poupança |
| `organizacao.json` | as pastas do gestor |
| `projetos-marcas.json` | as marcas dos projetos (também o que marcaste como já feito) |
| `saida\` | as mensagens à espera do carteiro |
| `orquestrador.json` | o id do chat orquestrador |
| `gestor.json` | a porta e o `pid` do servidor |
| `claude-a-frente.json` | o sinal para pôr a app do Claude à frente |
| `barra-posicao.json` | onde está a pílula |
| `app.log`, `gestor-erros.log` | os registos |

E `%LOCALAPPDATA%\NextUp\` guarda o perfil do WebView2 do gestor.

## API do gestor

Só em `127.0.0.1`. Os `POST` exigem um `Origin` local.

| Rota | O quê |
|---|---|
| `GET /api/saude` | responde ao guardião da app |
| `GET /api/estado` | o painel: à espera, a trabalhar, recentes, árvore, consumo, mensagens |
| `GET /api/projetos` | os quadrados dos projetos |
| `GET /api/historico` | o histórico de consumo |
| `POST /api/abrir` | abre um chat na app do Claude |
| `POST /api/organizacao` | pastas e ordem do gestor |
| `POST /api/projeto` | marcas dos projetos (dispensar, sem importância, esconder linhas, já feito) |
| `POST /api/dispensar` | dispensa um chat à espera, terminado ou a trabalhar até ao turno seguinte |
| `POST /api/ja-feito` | tira um chat da espera e regista no projeto que já está feito |
| `POST /api/lembrete` | dá um lembrete por feito ou adia-o |
| `POST /api/novo-chat` | abre um chat novo |
| `POST /api/mensagens/preparar` e `/enviar` | mensagens a chats |
| `POST /api/consumo/config` e `/taxa-bce` | subscrição e taxa de câmbio |

## Variáveis de ambiente

Para correr o gestor com dados de teste, sem tocar nos reais:

| Variável | O quê |
|---|---|
| `NEXTUP_RAIZ` | a pasta da fila (o servidor escreve lá `gestor.json`, `organizacao.json` e `saida\`) |
| `NEXTUP_SESSOES` | as sessões da app (`claude-code-sessions`) |
| `NEXTUP_CONFIG_APP` | o ficheiro de grupos (`claude_desktop_config.json`) |
| `NEXTUP_PROJETOS` | as transcrições (`~/.claude/projects`) |
| `NEXTUP_PROJETO` | a raiz onde o `NextUp.exe` procura `gestor\servidor.mjs` |

Para correr o gestor à mão: `node gestor\servidor.mjs` e abrir `http://127.0.0.1:4730`. Depois de mudar
`servidor.mjs` ou `gestor/lib/`, pára o processo `node` cuja linha de comandos contém `servidor.mjs`; a app
arranca outro em segundos (ou usa «Reiniciar o servidor do gestor» no ícone da bandeja). Mudanças em
`gestor/web/` só precisam de recarregar a página (F5 na janela do gestor).

## Dados de demonstração e capturas

As imagens do README vêm de dados 100 % fictícios (quatro projetos inventados, dez chats, vinte dias de uso), nunca
de chats reais. O `docs/demo/gerar-demo.mjs` (Node, sem dependências) gera-os com a mesma estrutura dos reais:
sessões da app (`local_*.json`), grupos do Claude, `organizacao.json` (pastas do gestor), itens e `barra.json` do
mod, `situacao/`, `consumo/` e transcrições `.jsonl` curtas para a aba Consumo ter histórico. As horas são
relativas a `Date.now()`: gera-se de novo antes de cada utilização.

```powershell
node docs\demo\gerar-demo.mjs $env:TEMP\nextup-demo
```

Imprime as variáveis `NEXTUP_RAIZ`, `NEXTUP_SESSOES`, `NEXTUP_CONFIG_APP` e `NEXTUP_PROJETOS` (e uma linha de PowerShell
pronta a copiar). Com elas definidas, `node gestor\servidor.mjs` corre o gestor sobre a demonstração; se a 4730
estiver ocupada, usa a seguinte livre (a porta fica em `<pasta>\nextup\gestor.json`). O gerador recusa pastas dentro de
`%USERPROFILE%\.claude`, `%APPDATA%\Claude` e `%LOCALAPPDATA%\NextUp`, e pastas não vazias que não sejam de uma execução
anterior dele (marca `.dados-de-demonstracao`). Não ligues o `NextUp.exe` real a esta pasta: ela vigia o gestor real.

Para refazer as imagens de `docs/capturas/` (precisa do Microsoft Edge, e do `NextUp.exe` para a pílula e o quadro):

```powershell
node docs\demo\capturar.mjs --demo $env:TEMP\nextup-demo --saida docs\capturas --exe app\publish\NextUp.exe
```

O script guia um Edge sem janela, com perfil novo e à parte, pelo protocolo de depuração (1440×900, tema escuro) e
tira o Painel, a ficha, os projetos (com o detalhe de um) e o Consumo; esconde só o grão de ruído do fundo, para os PNG
ficarem abaixo dos 400 KB. A pílula e o quadro saem de `NextUp.exe --previsao`, que só lê o `barra.json` da demonstração e
escreve dois PNG (não mexe no mutex, no guardião nem em `%USERPROFILE%\.claude\nextup`). Antes de publicar uma
imagem, abre-a e confirma que só tem dados fictícios.

## Linha de comandos da `NextUp.exe`

| Comando | O quê |
|---|---|
| `NextUp.exe` | o guardião (é o que o atalho de arranque corre) |
| `NextUp.exe --app` | a app, sem guardião |
| `NextUp.exe --sair` | pede ao NextUp em execução para sair |
| `NextUp.exe --arranque on\|off` | liga ou desliga o atalho de arranque do Windows |
| `NextUp.exe --previsao <pasta> [<barra.json>]` | desenha `pilula.png` e `quadro.png` |
| `NextUp.exe --autoteste` | testes internos da máquina de estados da tecla (resultado em `%LOCALAPPDATA%\NextUp\autoteste.txt`) |

## Compilar, testar e publicar

Precisa do SDK .NET 9 (o pacote `Microsoft.Web.WebView2` vem do NuGet) e do Node.js.

```powershell
# testes
$C = (Get-ChildItem "$env:APPDATA\Claude\claude-code\*\*\claude.exe" | Sort-Object LastWriteTime)[-1].FullName
& $C plugin validate mod ; & $C plugin test mod        # o `claude` do PATH não tem `plugin test`
node --test "gestor/test/*.test.mjs"                   # o padrão leva aspas (o Node 24 não expande uma pasta)
app\publish\NextUp.exe --autoteste

# compilar, publicar em app\publish\ e voltar a arrancar
powershell -NoProfile -ExecutionPolicy Bypass -File app\publicar.ps1 -Arrancar
```

O `publicar.ps1` pede ao NextUp em execução para sair, publica e, com `-Arrancar`, volta a pô-lo a correr desligada
da sessão (é de `app\publish\NextUp.exe` que o atalho de arranque o corre).

