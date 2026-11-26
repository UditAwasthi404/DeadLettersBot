#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define ROOT "/home/agent"
#define MAX_PATH_BYTES 4096

static void report_error(const char *context) {
  perror(context);
}

static int write_all(int fd, const char *buffer, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t written = write(fd, buffer + offset, length - offset);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) return -1;
    offset += (size_t)written;
  }
  return 0;
}

static int copy_stdin(int destination) {
  char buffer[16384];
  for (;;) {
    ssize_t count = read(STDIN_FILENO, buffer, sizeof(buffer));
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) return -1;
    if (count == 0) return 0;
    if (write_all(destination, buffer, (size_t)count) < 0) return -1;
  }
}

/* Resolve parent directories with O_NOFOLLOW at every component. */
static int open_parent(int root_fd, const char *relative, char **leaf_out) {
  if (strlen(relative) >= MAX_PATH_BYTES) {
    errno = ENAMETOOLONG;
    return -1;
  }

  char *path = strdup(relative);
  if (!path) return -1;
  int current = dup(root_fd);
  if (current < 0) {
    free(path);
    return -1;
  }

  char *save = NULL;
  char *part = strtok_r(path, "/", &save);
  if (!part) {
    *leaf_out = strdup(".");
    free(path);
    if (!*leaf_out) {
      close(current);
      return -1;
    }
    return current;
  }

  for (;;) {
    char *next = strtok_r(NULL, "/", &save);
    if (!strcmp(part, ".")) {
      if (!next) {
        *leaf_out = strdup(".");
        free(path);
        if (!*leaf_out) {
          close(current);
          return -1;
        }
        return current;
      }
      part = next;
      continue;
    }
    if (!strcmp(part, "..")) {
      errno = EACCES;
      close(current);
      free(path);
      return -1;
    }
    if (!next) {
      *leaf_out = strdup(part);
      free(path);
      if (!*leaf_out) {
        close(current);
        return -1;
      }
      return current;
    }

    int child = openat(current, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (child < 0) {
      close(current);
      free(path);
      return -1;
    }
    close(current);
    current = child;
    part = next;
  }
}

static int list_directory(int dir_fd) {
  DIR *directory = fdopendir(dir_fd);
  if (!directory) {
    close(dir_fd);
    return -1;
  }

  int result = 0;
  struct dirent *entry;
  for (;;) {
    errno = 0;
    entry = readdir(directory);
    if (!entry) {
      if (errno) result = -1;
      break;
    }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    struct stat info;
    if (fstatat(dirfd(directory), entry->d_name, &info, AT_SYMLINK_NOFOLLOW) < 0) continue;
    const char *kind = S_ISDIR(info.st_mode) ? "directory" : S_ISLNK(info.st_mode) ? "symlink" : S_ISREG(info.st_mode) ? "file" : "other";
    printf("%s\t%lld\t%s\n", kind, (long long)info.st_size, entry->d_name);
  }
  closedir(directory);
  return result;
}

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: agentos-file read|write|append|delete|list /home/agent/path\n");
    return 2;
  }

  const char *operation = argv[1];
  const char *path = argv[2];
  size_t root_length = strlen(ROOT);
  if (strncmp(path, ROOT, root_length) || (path[root_length] && path[root_length] != '/')) {
    fprintf(stderr, "path traversal denied\n");
    return 126;
  }

  const char *relative = path + root_length;
  while (*relative == '/') relative++;
  int root_fd = open(ROOT, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (root_fd < 0) {
    report_error("open workspace");
    return 1;
  }

  char *leaf = NULL;
  int parent_fd = open_parent(root_fd, relative, &leaf);
  close(root_fd);
  if (parent_fd < 0) {
    report_error("resolve workspace path");
    return 1;
  }

  int result = 0;
  if (!strcmp(operation, "list")) {
    int directory_fd = openat(parent_fd, leaf, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (directory_fd < 0) {
      report_error("open directory");
      result = 1;
    } else if (list_directory(directory_fd) < 0) {
      report_error("list directory");
      result = 1;
    }
  } else if (!strcmp(operation, "read")) {
    int input = openat(parent_fd, leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (input < 0) {
      report_error("open file");
      result = 1;
    } else {
      char buffer[16384];
      for (;;) {
        ssize_t count = read(input, buffer, sizeof(buffer));
        if (count < 0 && errno == EINTR) continue;
        if (count < 0) {
          report_error("read file");
          result = 1;
          break;
        }
        if (!count) break;
        if (write_all(STDOUT_FILENO, buffer, (size_t)count) < 0) {
          report_error("write output");
          result = 1;
          break;
        }
      }
      close(input);
    }
  } else if (!strcmp(operation, "write") || !strcmp(operation, "append")) {
    int flags = O_WRONLY | O_CREAT | O_NOFOLLOW | O_CLOEXEC;
    flags |= !strcmp(operation, "append") ? O_APPEND : O_TRUNC;
    int output = openat(parent_fd, leaf, flags, 0644);
    if (output < 0) {
      report_error("open file for writing");
      result = 1;
    } else {
      if (copy_stdin(output) < 0) {
        report_error("write file");
        result = 1;
      }
      close(output);
    }
  } else if (!strcmp(operation, "delete")) {
    if (!strcmp(leaf, ".") || unlinkat(parent_fd, leaf, 0) < 0) {
      if (!strcmp(leaf, ".")) errno = EISDIR;
      report_error("delete file");
      result = 1;
    }
  } else {
    fprintf(stderr, "unknown file operation\n");
    result = 2;
  }

  free(leaf);
  close(parent_fd);
  return result;
}
