/// Allocate short sequential refs: e1, e2, e3...
pub struct RefAllocator {
    next: usize,
}

impl RefAllocator {
    pub fn new() -> Self {
        Self { next: 1 }
    }

    pub fn allocate(&mut self) -> String {
        let id = format!("e{}", self.next);
        self.next += 1;
        id
    }
}

impl Default for RefAllocator {
    fn default() -> Self {
        Self::new()
    }
}
