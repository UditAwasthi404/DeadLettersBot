#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

static int landlock_create(const struct landlock_ruleset_attr *attr, size_t size, unsigned int flags) {
  return (int)syscall(SYS_landlock_create_ruleset, attr, size, flags);
}

static int landlock_add(int ruleset_fd, int path_fd, uint64_t access) {
  struct landlock_path_beneath_attr rule = {
      .allowed_access = access,
      .parent_fd = path_fd,
  };
  return (int)syscall(SYS_landlock_add_rule, ruleset_fd, LANDLOCK_RULE_PATH_BENEATH, &rule, 0);
}

static int add_path_rule(int ruleset_fd, const char *path, uint64_t access, int required) {
  int path_fd = open(path, O_PATH | O_CLOEXEC);
  if (path_fd < 0) {
    if (!required && (errno == ENOENT || errno == ENOTDIR)) return 0;
    fprintf(stderr, "agentos-shell: cannot open sandbox path %s: %s\n", path, strerror(errno));
    return -1;
  }
  int result = landlock_add(ruleset_fd, path_fd, access);
  int saved_errno = errno;
  close(path_fd);
  if (result < 0) {
    fprintf(stderr, "agentos-shell: cannot add sandbox rule for %s: %s\n", path, strerror(saved_errno));
    return -1;
  }
  return 0;
}

static uint64_t runtime_read_access(void) {
  return LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
}

static uint64_t workspace_access(int abi) {
  uint64_t access = runtime_read_access() |
      LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |
      LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG |
      LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK |
      LANDLOCK_ACCESS_FS_MAKE_SYM;
#ifdef LANDLOCK_ACCESS_FS_REFER
  if (abi >= 2) access |= LANDLOCK_ACCESS_FS_REFER;
#endif
#ifdef LANDLOCK_ACCESS_FS_TRUNCATE
  if (abi >= 3) access |= LANDLOCK_ACCESS_FS_TRUNCATE;
#endif
  return access;
}

static int restrict_filesystem(void) {
  int abi = landlock_create(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 1) {
    fprintf(stderr, "agentos-shell: Landlock filesystem sandbox is unavailable: %s\n", strerror(errno));
    return -1;
  }

  uint64_t handled = workspace_access(abi);
  struct landlock_ruleset_attr attr = { .handled_access_fs = handled };
  int ruleset_fd = landlock_create(&attr, sizeof(attr), 0);
  if (ruleset_fd < 0) {
    fprintf(stderr, "agentos-shell: cannot create Landlock ruleset: %s\n", strerror(errno));
    return -1;
  }

  int result = 0;
  result |= add_path_rule(ruleset_fd, "/home/agent", workspace_access(abi), 1);
  result |= add_path_rule(ruleset_fd, "/tmp", workspace_access(abi), 1);
  result |= add_path_rule(ruleset_fd, "/usr", runtime_read_access(), 1);
  result |= add_path_rule(ruleset_fd, "/etc", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR, 1);
  result |= add_path_rule(ruleset_fd, "/dev/null", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE, 0);
  result |= add_path_rule(ruleset_fd, "/dev/zero", LANDLOCK_ACCESS_FS_READ_FILE, 0);
  result |= add_path_rule(ruleset_fd, "/dev/urandom", LANDLOCK_ACCESS_FS_READ_FILE, 0);
  if (result < 0) {
    close(ruleset_fd);
    return -1;
  }

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0) {
    fprintf(stderr, "agentos-shell: cannot set no-new-privileges: %s\n", strerror(errno));
    close(ruleset_fd);
    return -1;
  }
  if (syscall(SYS_landlock_restrict_self, ruleset_fd, 0) < 0) {
    fprintf(stderr, "agentos-shell: cannot enforce Landlock ruleset: %s\n", strerror(errno));
    close(ruleset_fd);
    return -1;
  }
  close(ruleset_fd);
  return 0;
}

static void deny_syscall(struct sock_filter *filter, size_t *length, uint32_t syscall_number) {
  filter[(*length)++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, syscall_number, 0, 1);
  filter[(*length)++] = (struct sock_filter)BPF_STMT(
      BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA));
}

static int restrict_network(void) {
  struct sock_filter filter[40];
  size_t length = 0;
  filter[length++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
  deny_syscall(filter, &length, __NR_connect);
  deny_syscall(filter, &length, __NR_bind);
  deny_syscall(filter, &length, __NR_kill);
  deny_syscall(filter, &length, __NR_ptrace);
#ifdef __NR_tkill
  deny_syscall(filter, &length, __NR_tkill);
#endif
#ifdef __NR_tgkill
  deny_syscall(filter, &length, __NR_tgkill);
#endif
#ifdef __NR_process_vm_readv
  deny_syscall(filter, &length, __NR_process_vm_readv);
#endif
#ifdef __NR_process_vm_writev
  deny_syscall(filter, &length, __NR_process_vm_writev);
#endif
#ifdef __NR_pidfd_getfd
  deny_syscall(filter, &length, __NR_pidfd_getfd);
#endif
#ifdef __NR_socketcall
  deny_syscall(filter, &length, __NR_socketcall);
#endif
#ifdef __NR_io_uring_setup
  deny_syscall(filter, &length, __NR_io_uring_setup);
#endif
#ifdef __NR_io_uring_enter
  deny_syscall(filter, &length, __NR_io_uring_enter);
#endif
#ifdef __NR_io_uring_register
  deny_syscall(filter, &length, __NR_io_uring_register);
#endif

  filter[length++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
  size_t socket_check = length;
  filter[length++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socket, 0, 0);
  filter[length++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0]));
  size_t network_domains[3];
  const uint32_t domains[] = { AF_INET, AF_INET6, AF_PACKET };
  for (size_t i = 0; i < 3; i++) {
    network_domains[i] = length;
    filter[length++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, domains[i], 0, 0);
  }
  filter[length++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  size_t deny_index = length;
  filter[length++] = (struct sock_filter)BPF_STMT(
      BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA));
  size_t allow_index = length;
  filter[length++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);

  filter[socket_check].jf = (uint8_t)(allow_index - socket_check - 1);
  for (size_t i = 0; i < 3; i++)
    filter[network_domains[i]].jt = (uint8_t)(deny_index - network_domains[i] - 1);

  struct sock_fprog program = { .len = (unsigned short)length, .filter = filter };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) < 0) {
    fprintf(stderr, "agentos-shell: cannot enforce network filter: %s\n", strerror(errno));
    return -1;
  }
  return 0;
}

int main(int argc, char **argv) {
  int command_index = 1;
  if (command_index < argc && strcmp(argv[command_index], "--") == 0) command_index++;
  if (command_index >= argc) {
    fprintf(stderr, "usage: agentos-shell -- command [args...]\n");
    return 2;
  }
  if (restrict_filesystem() < 0 || restrict_network() < 0) return 126;
  execvp(argv[command_index], &argv[command_index]);
  fprintf(stderr, "agentos-shell: cannot execute %s: %s\n", argv[command_index], strerror(errno));
  return errno == ENOENT ? 127 : 126;
}
