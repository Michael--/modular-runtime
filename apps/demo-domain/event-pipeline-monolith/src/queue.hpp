#ifndef EVENT_PIPELINE_MONOLITH_QUEUE_HPP
#define EVENT_PIPELINE_MONOLITH_QUEUE_HPP

#include <condition_variable>
#include <mutex>
#include <queue>
#include <utility>

namespace pipeline {

template <typename T>
class BlockingQueue {
 public:
  explicit BlockingQueue(std::size_t max_size) : max_size_(max_size) {}

  bool push(T item) {
    std::unique_lock<std::mutex> lock(mutex_);
    not_full_.wait(lock, [this]() { return closed_ || max_size_ == 0 || queue_.size() < max_size_; });
    if (closed_) {
      return false;
    }
    queue_.push(std::move(item));
    not_empty_.notify_one();
    return true;
  }

  bool pop(T& out) {
    std::unique_lock<std::mutex> lock(mutex_);
    not_empty_.wait(lock, [this]() { return closed_ || !queue_.empty(); });
    if (queue_.empty()) {
      return false;
    }
    out = std::move(queue_.front());
    queue_.pop();
    not_full_.notify_one();
    return true;
  }

  void close() {
    std::lock_guard<std::mutex> lock(mutex_);
    closed_ = true;
    not_empty_.notify_all();
    not_full_.notify_all();
  }

  bool closed() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return closed_;
  }

 private:
  mutable std::mutex mutex_;
  std::condition_variable not_empty_;
  std::condition_variable not_full_;
  std::queue<T> queue_;
  std::size_t max_size_ = 0;
  bool closed_ = false;
};

} // namespace pipeline

#endif
